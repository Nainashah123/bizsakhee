import { NextResponse } from "next/server";
import { z } from "zod";

import { generateSmartReply } from "@/lib/ai/generate";
import { aiProviderStatus } from "@/lib/ai/provider";
import { consumeAiGeneration } from "@/lib/ai/quota";
import { smartReplyInputSchema } from "@/lib/ai/schemas";
import { requireCapability } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { httpStatusFor, type ErrorCode } from "@/lib/result";
import { fieldErrorsFrom } from "@/lib/validation/form";

/**
 * Draft a reply to a customer's message.
 *
 * POST /api/ai/reply
 *   request  {
 *              "customerMessage": "Do you have this in red?",   // required, <= 2000 chars
 *              "contactName": "Meera",                           // optional
 *              "context": "she ordered last Diwali",             // optional
 *              "tone": "friendly",                               // optional, defaults to "friendly"
 *              "language": "hinglish"                            // optional, defaults to "en"
 *            }
 *   200      {
 *              "output": { "reply": "...", "followUpQuestion": "..." },
 *              "generationId": "uuid | null",
 *              "quota": { "used": 3, "limit": 20, "remaining": 17 } | null
 *            }
 *   4xx/5xx  { "error": "<code>", "message": "...", ...extras }
 *
 * This route DRAFTS. It never sends anything to a customer: the seller reads
 * the draft, edits it and sends it from her own WhatsApp.
 *
 * The workspace is never taken from the body - `requireCapability` resolves it
 * from the session and asserts the role may use AI at all (members may not).
 * Unknown keys are rejected outright rather than silently dropped.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject(smartReplyInputSchema.shape);

function fail(
  code: ErrorCode,
  message: string,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  return NextResponse.json(
    { error: code, message, ...extra },
    {
      status: httpStatusFor(code),
      headers: { "cache-control": "no-store", ...headers },
    },
  );
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("validation", "Send a JSON body with the customer's message.");
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    // Field paths and our own messages only - never the submitted values.
    return fail("validation", "Please check the highlighted fields.", {
      fieldErrors: fieldErrorsFrom(parsed.error),
    });
  }

  const authorized = await requireCapability("ai.use");
  if (!authorized.ok) {
    return fail(authorized.error.code, authorized.error.message);
  }
  const { user, workspace } = authorized.data;

  const status = aiProviderStatus();
  if (!status.configured) {
    return fail(
      "not_configured",
      "AI is not configured on this deployment yet, so there is nothing to draft with.",
      { missing: [status.missing] },
    );
  }

  const limit = rateLimit(
    `ai:${user.id}`,
    RATE_LIMITS.ai.limit,
    RATE_LIMITS.ai.windowMs,
  );
  if (!limit.allowed) {
    const retryAfter = Math.max(
      1,
      Math.ceil((limit.resetAt - Date.now()) / 1000),
    );
    return fail(
      "rate_limited",
      `That is a lot of drafts at once. Please wait ${retryAfter} second${retryAfter === 1 ? "" : "s"} and try again.`,
      { retryAfterSeconds: retryAfter },
      { "retry-after": String(retryAfter) },
    );
  }

  // Charged before the model runs, and only for a live provider - the mock
  // provider costs nothing and must not eat a seller's monthly allowance.
  const isMock = status.provider === "mock";
  const quota = isMock ? null : await consumeAiGeneration(workspace.id);

  if (quota && !quota.ok) {
    if (quota.error.code === "limit_reached") {
      logger.info("ai_quota_exhausted", {
        tool: "smart_reply",
        workspaceId: workspace.id,
      });
      // The message already names the plan she is on and the cheapest plan that
      // raises the cap; the link is all the client needs to add.
      return fail("limit_reached", quota.error.message, {
        upgradeHref: "/dashboard/billing",
      });
    }
    return fail(quota.error.code, quota.error.message);
  }

  const result = await generateSmartReply(parsed.data, {
    workspaceId: workspace.id,
    userId: user.id,
  });

  if (!result.ok) {
    return fail(result.error.code, result.error.message);
  }

  return NextResponse.json(
    {
      output: result.data.output,
      generationId: result.data.generationId,
      quota: quota?.ok
        ? {
            used: quota.data.used,
            limit: quota.data.limit,
            remaining: quota.data.remaining,
          }
        : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
