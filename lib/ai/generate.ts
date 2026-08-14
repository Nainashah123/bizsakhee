import "server-only";

import { generateText, Output } from "ai";
import type { z } from "zod";

import { contentPrompt, smartReplyPrompt } from "@/lib/ai/prompts";
import {
  AI_MAX_RETRIES,
  AI_TIMEOUT_MS,
  aiProviderStatus,
  resolveModel,
} from "@/lib/ai/provider";
import {
  contentOutputSchema,
  smartReplyOutputSchema,
  type AiToolName,
  type ContentInput,
  type ContentOutput,
  type SmartReplyInput,
  type SmartReplyOutput,
} from "@/lib/ai/schemas";
import { logger } from "@/lib/logger";
import { err, ok, type Result } from "@/lib/result";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * The single generation entry point for both AI tools.
 *
 * Order of operations, and why:
 *
 *   1. Resolve the model. A null model means the mock provider, which returns
 *      deterministic canned output without touching the network. That is what
 *      CI and the unit tests run on, so the same input always gives the same
 *      output and a test never depends on a provider being up.
 *   2. Otherwise call the model with the tool's schema, a hard timeout and a
 *      small retry budget.
 *   3. Re-validate whatever came back against the same Zod schema. The SDK
 *      already parses it, but model output is untrusted input and a second
 *      check costs microseconds. A schema miss is a failure, never something we
 *      render best-effort.
 *   4. Record the attempt - success or failure - in `ai_generations`.
 *
 * Nothing here throws for an expected failure and nothing leaks a provider
 * error to the client: the caller gets a `Result` with a sentence a seller can
 * read. The customer's message and the generated text are never logged, and
 * `input_summary` carries only the structured knobs (tone, language, platform,
 * objective) - never the words.
 *
 * This module is server-only. It reads provider keys through `lib/ai/provider`
 * and must never be imported by a Client Component.
 */

export type AiGenerationContext = {
  /** Resolved server-side through `lib/auth`. Never taken from the browser. */
  workspaceId: string;
  userId: string | null;
};

export type AiGenerationResult<T> = {
  output: T;
  /** Row id in `ai_generations`, or null when the audit write failed. */
  generationId: string | null;
  latencyMs: number;
};

/** Structured knobs only. No message bodies, no captions, no names. */
type InputSummary = Record<string, string | number | boolean>;

const TIMEOUT_MESSAGE =
  "The AI took too long to answer. Please try again - it is usually quicker on a second attempt.";
const INVALID_OUTPUT_MESSAGE =
  "The AI sent back something we could not use, so we have not shown it. Please try again.";
const PROVIDER_MESSAGE =
  "We could not reach the AI just now. Please try again in a moment.";
const NOT_CONFIGURED_MESSAGE =
  "AI is not configured on this deployment yet, so there is nothing to draft with.";

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

type FailureCode = "timeout" | "invalid_output" | "provider_error";

/**
 * `AbortSignal.timeout` raises a `TimeoutError`, a caller-cancelled request an
 * `AbortError`, and the SDK may wrap either in its own error. Walk the cause
 * chain rather than matching on a message, which is provider-specific.
 */
function isTimeout(error: unknown, depth = 0): boolean {
  if (depth > 5 || !(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  return isTimeout(error.cause, depth + 1);
}

function classify(error: unknown): { code: FailureCode; message: string } {
  if (isTimeout(error)) return { code: "timeout", message: TIMEOUT_MESSAGE };
  return { code: "provider_error", message: PROVIDER_MESSAGE };
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

/**
 * Records one attempt.
 *
 * `output` is deliberately left null: the draft belongs to the seller until she
 * chooses to keep it, and a content draft she approves is stored explicitly by
 * `features/ai/actions.ts` instead.
 *
 * A failure to write the audit row never fails the generation - the seller
 * already has her draft, and losing a metrics row is not worth throwing it away.
 */
async function record(params: {
  ctx: AiGenerationContext;
  tool: AiToolName;
  provider: string;
  model: string;
  inputSummary: InputSummary;
  latencyMs: number;
  succeeded: boolean;
  errorCode?: string;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("ai_generations")
      .insert({
        workspace_id: params.ctx.workspaceId,
        user_id: params.ctx.userId,
        tool: params.tool,
        provider: params.provider,
        model: params.model,
        input_summary: params.inputSummary as Json,
        input_tokens: params.inputTokens ?? null,
        output_tokens: params.outputTokens ?? null,
        latency_ms: params.latencyMs,
        succeeded: params.succeeded,
        error_code: params.errorCode ?? null,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      logger.error("ai_generation_record_failed", {
        tool: params.tool,
        code: error.code,
      });
      return null;
    }

    return data?.id ?? null;
  } catch (cause) {
    logger.error("ai_generation_record_threw", {
      tool: params.tool,
      error: cause instanceof Error ? cause.name : "unknown",
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// The generic run
// ---------------------------------------------------------------------------

async function run<T>(args: {
  tool: AiToolName;
  schema: z.ZodType<T>;
  schemaName: string;
  schemaDescription: string;
  system: string;
  prompt: string;
  inputSummary: InputSummary;
  /** Deterministic canned output used when the provider is `mock`. */
  sample: () => T;
  ctx: AiGenerationContext;
}): Promise<Result<AiGenerationResult<T>>> {
  const status = aiProviderStatus();
  if (!status.configured) {
    // Reported without calling `resolveModel`, which throws in this state.
    return err("not_configured", NOT_CONFIGURED_MESSAGE);
  }

  const startedAt = Date.now();

  let raw: unknown;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  try {
    const model = await resolveModel();

    if (model === null) {
      // Mock provider: canned, deterministic, no network.
      raw = args.sample();
    } else {
      const result = await generateText({
        model,
        system: args.system,
        prompt: args.prompt,
        output: Output.object({
          schema: args.schema,
          name: args.schemaName,
          description: args.schemaDescription,
        }),
        abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
        maxRetries: AI_MAX_RETRIES,
      });

      raw = result.output;
      inputTokens = result.usage.inputTokens;
      outputTokens = result.usage.outputTokens;
    }
  } catch (cause) {
    const failure = classify(cause);
    const latencyMs = Date.now() - startedAt;

    // The error itself is never forwarded: provider messages can carry request
    // ids, account names and fragments of the prompt.
    logger.error("ai_generation_failed", {
      tool: args.tool,
      provider: status.provider,
      model: status.model,
      latencyMs,
      errorCode: failure.code,
    });

    await record({
      ctx: args.ctx,
      tool: args.tool,
      provider: status.provider,
      model: status.model,
      inputSummary: args.inputSummary,
      latencyMs,
      succeeded: false,
      errorCode: failure.code,
    });

    return err("upstream_error", failure.message);
  }

  // Second gate. The SDK validated once; we do not take its word for it.
  const parsed = args.schema.safeParse(raw);
  const latencyMs = Date.now() - startedAt;

  if (!parsed.success) {
    logger.error("ai_generation_invalid_output", {
      tool: args.tool,
      provider: status.provider,
      model: status.model,
      latencyMs,
      // Field paths only - never the values that failed.
      fields: parsed.error.issues.map((issue) => issue.path.join(".")),
    });

    await record({
      ctx: args.ctx,
      tool: args.tool,
      provider: status.provider,
      model: status.model,
      inputSummary: args.inputSummary,
      latencyMs,
      succeeded: false,
      errorCode: "invalid_output",
      inputTokens,
      outputTokens,
    });

    return err("upstream_error", INVALID_OUTPUT_MESSAGE);
  }

  const generationId = await record({
    ctx: args.ctx,
    tool: args.tool,
    provider: status.provider,
    model: status.model,
    inputSummary: args.inputSummary,
    latencyMs,
    succeeded: true,
    inputTokens,
    outputTokens,
  });

  logger.info("ai_generation_succeeded", {
    tool: args.tool,
    provider: status.provider,
    model: status.model,
    latencyMs,
  });

  return ok({ output: parsed.data, generationId, latencyMs });
}

// ---------------------------------------------------------------------------
// Deterministic sample output for the mock provider
// ---------------------------------------------------------------------------

/**
 * FNV-1a. Not a security hash - it exists so the canned output varies with the
 * input while staying perfectly reproducible for the same input.
 */
function fingerprint(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function pick<T>(options: readonly T[], seed: number): T {
  return options[seed % options.length];
}

/**
 * The mock reply is written as a fill-in-the-blanks template on purpose. It is
 * canned text, not a model's answer, and it should read like one so nobody
 * mistakes it for a real draft. The customer's own words are never echoed back;
 * only a fingerprint of the input is used, so the output stays deterministic
 * without carrying the message around.
 */
function sampleSmartReply(input: SmartReplyInput): SmartReplyOutput {
  const seed = fingerprint(
    [
      input.customerMessage,
      input.contactName ?? "",
      input.context ?? "",
      input.tone,
      input.language,
    ].join(" "),
  );

  const greeting = input.contactName ? `Hi ${input.contactName},` : "Hi there,";
  const opening = pick(
    [
      "thank you for writing in.",
      "thanks so much for your message.",
      "lovely to hear from you.",
    ],
    seed,
  );

  return {
    reply: [
      `${greeting} ${opening}`,
      "",
      "[Offline sample draft - no AI provider is configured on this deployment, so this is a template rather than a written reply.]",
      "",
      "[Answer their question here.] I will confirm [price / delivery time / availability] and come back to you shortly.",
    ].join("\n"),
    followUpQuestion:
      "Could you let me know your pin code so I can check the delivery time?",
  };
}

/** Turns free text into one valid hashtag, or null when nothing usable is left. */
function hashtagFrom(value: string): string | null {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 30);
  return cleaned.length > 0 ? `#${cleaned}` : null;
}

function sampleContent(input: ContentInput): ContentOutput {
  const seed = fingerprint(
    [
      input.productName,
      input.productDescription ?? "",
      input.priceLabel ?? "",
      input.offer ?? "",
      input.platform,
      input.objective,
      input.tone,
      input.language,
      input.imageContext ?? "",
    ].join(" "),
  );

  const opener = pick(
    ["Just in:", "Back on the shelf:", "Made with care:"],
    seed,
  );

  const productTag = hashtagFrom(input.productName);
  const hashtags = ["#smallbusiness", "#handmade", "#shoplocal"];
  if (productTag && !hashtags.includes(productTag)) hashtags.push(productTag);

  const offerLine = input.offer ? `Offer: ${input.offer}` : null;
  const priceLine = input.priceLabel ? `Price: ${input.priceLabel}` : null;

  const caption = [
    `${opener} ${input.productName}.`,
    "",
    "[Offline sample draft - no AI provider is configured on this deployment, so this is a template rather than written copy.]",
    "",
    "[Say what makes it special in a line or two.]",
    ...(priceLine ? [priceLine] : []),
    ...(offerLine ? [offerLine] : []),
  ].join("\n");

  return {
    hook: `${opener} ${input.productName}`.slice(0, 160),
    caption: caption.slice(0, 1_500),
    callToAction: "Message me on WhatsApp to order.",
    hashtags,
    whatsappMessage: [
      `${opener} ${input.productName}.`,
      ...(priceLine ? [priceLine] : []),
      ...(offerLine ? [offerLine] : []),
      "Reply here if you would like one.",
    ]
      .join("\n")
      .slice(0, 700),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateSmartReply(
  input: SmartReplyInput,
  ctx: AiGenerationContext,
): Promise<Result<AiGenerationResult<SmartReplyOutput>>> {
  const { system, prompt } = smartReplyPrompt(input);

  return run({
    tool: "smart_reply",
    schema: smartReplyOutputSchema,
    schemaName: "smart_reply",
    schemaDescription:
      "A sendable reply to a customer, and optionally one follow-up question.",
    system,
    prompt,
    inputSummary: {
      tone: input.tone,
      language: input.language,
      hasContactName: Boolean(input.contactName),
      hasContext: Boolean(input.context),
    },
    sample: () => sampleSmartReply(input),
    ctx,
  });
}

export async function generateMarketingContent(
  input: ContentInput,
  ctx: AiGenerationContext,
): Promise<Result<AiGenerationResult<ContentOutput>>> {
  const { system, prompt } = contentPrompt(input);

  return run({
    tool: "content_generator",
    schema: contentOutputSchema,
    schemaName: "marketing_content",
    schemaDescription:
      "A hook, caption, call to action, hashtags and a shorter WhatsApp version.",
    system,
    prompt,
    inputSummary: {
      tone: input.tone,
      language: input.language,
      platform: input.platform,
      objective: input.objective,
      hasOffer: Boolean(input.offer),
      hasPrice: Boolean(input.priceLabel),
      hasImageContext: Boolean(input.imageContext),
      hasDescription: Boolean(input.productDescription),
    },
    sample: () => sampleContent(input),
    ctx,
  });
}

/** Test-only surface for the deterministic mock output. */
export const __sampleForTests = {
  smartReply: sampleSmartReply,
  content: sampleContent,
};
