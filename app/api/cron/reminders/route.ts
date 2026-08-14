import { NextResponse } from "next/server";

import { authorizeCronRequest } from "@/lib/cron/auth";
import { serverEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Follow-up reminders.
 *
 * Scheduled by `vercel.json`. Finds open follow-ups that are due, or fall due
 * within the next 24 hours, and have not been chased yet; writes one
 * notification per assignee and stamps `reminder_sent_at` so a re-run - or a
 * retry after a timeout - cannot notify the same person twice.
 *
 * There is no user session on a cron request, so:
 *   - authorisation is a timing-safe `CRON_SECRET` check, and a missing secret
 *     returns 503 rather than running unauthenticated;
 *   - the service-role client is used, which bypasses RLS. Every statement
 *     therefore carries its own predicates and the workspace id is copied from
 *     the task row itself.
 *
 * Nothing here logs the secret, the presented token, or task content.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Upper bound on rows touched per invocation, so one run cannot run long. */
const SCAN_LIMIT = 500;
/** Rows per insert/claim round trip. */
const BATCH_SIZE = 50;
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
const NOTIFICATION_KIND = "task_reminder";
const MAX_TITLE_LENGTH = 160;

type DueTask = {
  id: string;
  workspace_id: string;
  title: string;
  due_at: string | null;
  assigned_to: string | null;
};

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function noStore(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(request: Request) {
  const startedAt = Date.now();

  const auth = authorizeCronRequest(
    request.headers.get("authorization"),
    serverEnv().CRON_SECRET,
  );

  if (auth.status === "not_configured") {
    logger.warn("cron_reminders_not_configured", { job: "reminders" });
    return noStore(
      {
        ok: false,
        error: "not_configured",
        message: auth.reason,
        hint: "Set CRON_SECRET in the project environment and redeploy.",
      },
      503,
    );
  }

  if (auth.status === "unauthorized") {
    // Deliberately no token, no header and no length: only that it failed.
    logger.warn("cron_reminders_unauthorized", { job: "reminders" });
    return noStore({ ok: false, error: "unauthorized" }, 401);
  }

  if (!serverEnv().SUPABASE_SECRET_KEY) {
    logger.warn("cron_reminders_missing_service_role", { job: "reminders" });
    return noStore(
      {
        ok: false,
        error: "not_configured",
        message:
          "SUPABASE_SECRET_KEY is not set, so this job cannot read tasks without a user session.",
        hint: "Add the Supabase service role key to the project environment.",
      },
      503,
    );
  }

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch (error) {
    logger.error("cron_reminders_client_failed", { job: "reminders", error });
    return noStore(
      {
        ok: false,
        error: "not_configured",
        message: "The service-role Supabase client could not be created.",
      },
      503,
    );
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + LOOKAHEAD_MS);

  const { data, error } = await supabase
    .from("tasks")
    .select("id, workspace_id, title, due_at, assigned_to")
    .eq("status", "open")
    .is("reminder_sent_at", null)
    .not("due_at", "is", null)
    .lte("due_at", horizon.toISOString())
    .order("due_at", { ascending: true })
    .limit(SCAN_LIMIT);

  if (error) {
    logger.error("cron_reminders_scan_failed", {
      job: "reminders",
      code: error.code,
    });
    return noStore(
      { ok: false, error: "upstream_error", message: "Task scan failed." },
      502,
    );
  }

  const scanned = (data ?? []) as DueTask[];
  const actionable = scanned.filter((task) => Boolean(task.assigned_to));
  const skippedUnassigned = scanned.length - actionable.length;

  let notified = 0;
  let failed = 0;

  for (const batch of chunk(actionable, BATCH_SIZE)) {
    const ids = batch.map((task) => task.id);

    // Claim first: the conditional update is the only thing that makes a
    // concurrent or retried run idempotent. Only rows this call actually
    // flipped from null come back, and only those get a notification.
    const { data: claimed, error: claimError } = await supabase
      .from("tasks")
      .update({ reminder_sent_at: now.toISOString() })
      .in("id", ids)
      .is("reminder_sent_at", null)
      .eq("status", "open")
      .select("id");

    if (claimError) {
      logger.error("cron_reminders_claim_failed", {
        job: "reminders",
        code: claimError.code,
        batchSize: ids.length,
      });
      failed += ids.length;
      continue;
    }

    const claimedIds = new Set((claimed ?? []).map((row) => row.id));
    const toNotify = batch.filter((task) => claimedIds.has(task.id));
    if (toNotify.length === 0) continue;

    const rows = toNotify.map((task) => ({
      workspace_id: task.workspace_id,
      user_id: task.assigned_to,
      kind: NOTIFICATION_KIND,
      title: `Follow-up due: ${truncate(task.title, MAX_TITLE_LENGTH)}`,
      // The raw instant, so the reader renders it in their own timezone.
      body: task.due_at,
      href: "/dashboard/tasks?view=due_today",
    }));

    const { error: insertError } = await supabase
      .from("notifications")
      .insert(rows);

    if (insertError) {
      logger.error("cron_reminders_notify_failed", {
        job: "reminders",
        code: insertError.code,
        batchSize: rows.length,
      });
      failed += rows.length;

      // Release the claim so the next run retries instead of silently
      // swallowing the reminder.
      const { error: releaseError } = await supabase
        .from("tasks")
        .update({ reminder_sent_at: null })
        .in("id", [...claimedIds]);

      if (releaseError) {
        logger.error("cron_reminders_release_failed", {
          job: "reminders",
          code: releaseError.code,
        });
      }
      continue;
    }

    notified += rows.length;
  }

  const summary = {
    ok: failed === 0,
    scanned: scanned.length,
    notified,
    skippedUnassigned,
    failed,
    truncated: scanned.length === SCAN_LIMIT,
    durationMs: Date.now() - startedAt,
  };

  logger.info("cron_reminders_completed", { job: "reminders", ...summary });

  return noStore(summary, failed === 0 ? 200 : 207);
}
