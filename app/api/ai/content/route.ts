import { NextResponse } from "next/server";
import { z } from "zod";

import { generateMarketingContent } from "@/lib/ai/generate";
import { aiProviderStatus } from "@/lib/ai/provider";
import { consumeAiGeneration } from "@/lib/ai/quota";
import { contentInputSchema } from "@/lib/ai/schemas";
import { requireCapability } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { httpStatusFor, type ErrorCode } from "@/lib/result";
import { fieldErrorsFrom } from "@/lib/validation/form";

/**
 * Draft marketing copy for a product.
 *
 * POST /api/ai/content
 *   request  {
 *              "productName": "Kantha work cotton saree",   // required, <= 160 chars
 *              "productDescription": "hand stitched...",    // optional
 *              "priceLabel": "Rs 2,400",                    // optional, shown verbatim
 *              "platform": "instagram",                     // optional, defaults to "instagram"
 *              "objective": "announce_product",             // optional, defaults to "announce_product"
 *              "offer": "Free delivery this week",          // optional
 *              "tone": "warm",                              // optional, defaults to "friendly"
 *              "language": "en",                            // optional, defaults to "en"
 *              "imageContext": "saree on a cane chair"      // optional
 *            }
 *   200      {
 *              "output": {
 *                "hook": "...",
 *                "caption": "...",
 *                "callToAction": "...",
 *                "hashtags": ["#handmade"],
 *                "whatsappMessage": "..."
 *              },
 *              "generationId": "uuid | null",
 *              "quota": { "used": 3, "limit": 20, "remaining": 17 } | null
 *            }
 *   4xx/5xx  { "error": "<code>", "message": "...", ...extras }
 *
 * Drafting only. Nothing is posted anywhere and nothing is stored: a draft is
 * kept only when the seller saves it through `features/ai/actions.ts`.
 *
 * The workspace comes from the session, never from the body, and unknown keys
 * are rejected rather than silently dropped.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.strictObject(contentInputSchema.shape);

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
    return fail("validation", "Send a JSON body with a product name.");
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
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

  // Charged before the model runs, and only for a live provider.
  const isMock = status.provider === "mock";
  const quota = isMock ? null : await consumeAiGeneration(workspace.id);

  if (quota && !quota.ok) {
    if (quota.error.code === "limit_reached") {
      logger.info("ai_quota_exhausted", {
        tool: "content_generator",
        workspaceId: workspace.id,
      });
      return fail("limit_reached", quota.error.message, {
        upgradeHref: "/dashboard/billing",
      });
    }
    return fail(quota.error.code, quota.error.message);
  }

  const result = await generateMarketingContent(parsed.data, {
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
