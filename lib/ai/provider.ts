import "server-only";

import type { LanguageModel } from "ai";

import { serverEnv } from "@/lib/env";

/**
 * AI provider abstraction.
 *
 * Three providers are supported:
 *   anthropic      - the Anthropic API directly, via ANTHROPIC_API_KEY
 *   vercel-gateway - the Vercel AI Gateway, via AI_GATEWAY_API_KEY
 *   mock           - deterministic canned output, no network, for tests and CI
 *
 * Provider keys are read here and nowhere else, always on the server. Nothing
 * in this module may be imported from a Client Component.
 */

export type AiProviderName = "anthropic" | "vercel-gateway" | "mock";

export type AiProviderStatus =
  | { configured: true; provider: AiProviderName; model: string }
  | {
      configured: false;
      provider: AiProviderName;
      model: string;
      /** The exact environment variable the operator still has to set. */
      missing: string;
    };

/**
 * Default model per provider. The gateway addresses models as
 * "<provider>/<model>", the Anthropic provider by bare model id.
 */
const DEFAULT_MODEL: Record<AiProviderName, string> = {
  anthropic: "claude-sonnet-5",
  "vercel-gateway": "anthropic/claude-sonnet-5",
  mock: "mock-model",
};

export function aiProviderStatus(): AiProviderStatus {
  const env = serverEnv();
  const provider = env.AI_PROVIDER as AiProviderName;
  const model = env.AI_MODEL || DEFAULT_MODEL[provider];

  if (provider === "mock") {
    return { configured: true, provider, model: DEFAULT_MODEL.mock };
  }

  if (provider === "anthropic") {
    return env.ANTHROPIC_API_KEY
      ? { configured: true, provider, model }
      : { configured: false, provider, model, missing: "ANTHROPIC_API_KEY" };
  }

  return env.AI_GATEWAY_API_KEY
    ? { configured: true, provider, model }
    : { configured: false, provider, model, missing: "AI_GATEWAY_API_KEY" };
}

export function isAiConfigured(): boolean {
  return aiProviderStatus().configured;
}

/**
 * The model handle to pass to the AI SDK.
 *
 * Returns null for the mock provider, which never reaches the network - the
 * caller substitutes canned output instead.
 *
 * The two live providers are NOT interchangeable strings: a bare
 * "<provider>/<model>" string is resolved by the AI SDK's default global
 * provider, which is the Vercel Gateway. Returning a string for the Anthropic
 * provider would therefore route the call through the gateway and ignore
 * ANTHROPIC_API_KEY entirely, so that path builds a real model instance.
 */
export async function resolveModel(): Promise<LanguageModel | null> {
  const status = aiProviderStatus();
  if (!status.configured) {
    throw new Error(
      `AI provider "${status.provider}" is selected but ${status.missing} is not set.`,
    );
  }

  if (status.provider === "mock") return null;

  if (status.provider === "vercel-gateway") {
    // The gateway is the default global provider, so the string resolves
    // without importing a provider package.
    return status.model;
  }

  // Imported lazily so a gateway-only or mock deployment never loads it.
  const { createAnthropic } = await import("@ai-sdk/anthropic");
  const anthropic = createAnthropic({
    apiKey: serverEnv().ANTHROPIC_API_KEY,
  });
  return anthropic(status.model);
}

/** Timeout for a single generation. Long enough for a paragraph, not a novel. */
export const AI_TIMEOUT_MS = 30_000;

/**
 * Retries handled by the AI SDK. Only safe transient failures are retried;
 * a schema-validation failure is not retried here because a second identical
 * request would usually fail the same way.
 */
export const AI_MAX_RETRIES = 2;
