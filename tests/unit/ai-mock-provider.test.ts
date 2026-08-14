/**
 * The mock provider path.
 *
 * @vitest-environment node
 *
 * The node environment matters: `serverEnv()` refuses to run where `window`
 * exists, which is the guard keeping provider keys out of the browser bundle.
 * Under the default jsdom environment every call would throw.
 *
 * `AI_PROVIDER` is "mock" in `tests/setup.ts`, so `resolveModel()` returns null
 * and `lib/ai/generate` substitutes canned output. Three things are asserted:
 * the canned output satisfies the same Zod schema a real model's answer has to
 * satisfy, the same input always produces the same output, and nothing touches
 * the network.
 *
 * Only Supabase - an external service - is mocked. The generation path itself,
 * including the second schema validation, runs for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  insertError: null as { code: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        mocks.inserted.push(row);
        return {
          select: () => ({
            maybeSingle: async () =>
              mocks.insertError
                ? { data: null, error: mocks.insertError }
                : {
                    data: { id: "11111111-1111-4111-8111-111111111111" },
                    error: null,
                  },
          }),
        };
      },
    }),
  }),
}));

import {
  generateMarketingContent,
  generateSmartReply,
} from "@/lib/ai/generate";
import { aiProviderStatus } from "@/lib/ai/provider";
import {
  contentOutputSchema,
  smartReplyInputSchema,
  contentInputSchema,
  smartReplyOutputSchema,
} from "@/lib/ai/schemas";

const CTX = {
  workspaceId: "3f1c0c9e-6a3d-4d21-8f0a-2a6b7c8d9e01",
  userId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
};

const CUSTOMER_MESSAGE =
  "Hi, do you still have the blue kantha saree? My sister wants one for a wedding.";

const replyInput = smartReplyInputSchema.parse({
  customerMessage: CUSTOMER_MESSAGE,
  contactName: "Meera",
  context: "She ordered a dupatta last Diwali",
  tone: "warm",
  language: "hinglish",
});

const contentInput = contentInputSchema.parse({
  productName: "Kantha work cotton saree",
  productDescription: "Hand stitched over three weeks",
  priceLabel: "Rs 2,400",
  offer: "Free delivery this week",
  platform: "instagram",
  objective: "announce_product",
  tone: "warm",
  language: "en",
});

const fetchSpy = vi.fn(() => {
  throw new Error("The mock provider must never reach the network");
});

beforeEach(() => {
  mocks.inserted = [];
  mocks.insertError = null;
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the test environment", () => {
  it("really is running the mock provider", () => {
    const status = aiProviderStatus();
    expect(status.configured).toBe(true);
    expect(status.provider).toBe("mock");
  });
});

describe("generateSmartReply with the mock provider", () => {
  it("returns output that passes the smart reply schema", async () => {
    const result = await generateSmartReply(replyInput, CTX);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The strict gate, not a loose shape check: the same schema a live model
    // has to satisfy.
    expect(() =>
      smartReplyOutputSchema.parse(result.data.output),
    ).not.toThrow();
    expect(result.data.output.reply.length).toBeGreaterThan(0);
  });

  it("is deterministic - the same input twice gives byte-identical output", async () => {
    const first = await generateSmartReply(replyInput, CTX);
    const second = await generateSmartReply(replyInput, CTX);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.data.output).toEqual(first.data.output);
    expect(JSON.stringify(second.data.output)).toBe(
      JSON.stringify(first.data.output),
    );
  });

  it("varies with the input rather than being one fixed string", async () => {
    const other = await generateSmartReply(
      { ...replyInput, contactName: "Asha" },
      CTX,
    );
    const original = await generateSmartReply(replyInput, CTX);

    expect(other.ok && original.ok).toBe(true);
    if (!other.ok || !original.ok) return;
    expect(other.data.output.reply).not.toBe(original.data.output.reply);
  });

  it("never echoes the customer's message back into the draft", async () => {
    const result = await generateSmartReply(replyInput, CTX);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.output.reply).not.toContain("kantha saree");
    expect(result.data.output.reply).not.toContain(CUSTOMER_MESSAGE);
  });

  it("makes no network request at all", async () => {
    await generateSmartReply(replyInput, CTX);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("generateMarketingContent with the mock provider", () => {
  it("returns output that passes the content schema, hashtags included", async () => {
    const result = await generateMarketingContent(contentInput, CTX);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(() => contentOutputSchema.parse(result.data.output)).not.toThrow();
    for (const hashtag of result.data.output.hashtags) {
      expect(hashtag).toMatch(/^#[\p{L}\p{N}_]+$/u);
    }
  });

  it("is deterministic across repeated calls", async () => {
    const first = await generateMarketingContent(contentInput, CTX);
    const second = await generateMarketingContent(contentInput, CTX);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.data.output).toEqual(first.data.output);
  });

  it("uses the facts it was given and invents no others", async () => {
    const result = await generateMarketingContent(contentInput, CTX);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.output.caption).toContain("Rs 2,400");
    expect(result.data.output.caption).toContain("Free delivery this week");

    const withoutPrice = await generateMarketingContent(
      contentInputSchema.parse({ productName: "Kantha work cotton saree" }),
      CTX,
    );
    expect(withoutPrice.ok).toBe(true);
    if (!withoutPrice.ok) return;
    // No price was supplied, so none may appear.
    expect(withoutPrice.data.output.caption).not.toContain("Rs");
    expect(withoutPrice.data.output.whatsappMessage).not.toContain("Rs");
  });

  it("builds a valid hashtag from a product name full of punctuation", async () => {
    const result = await generateMarketingContent(
      contentInputSchema.parse({
        productName: "Chikankari kurta (XL) - 100% cotton!",
      }),
      CTX,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => contentOutputSchema.parse(result.data.output)).not.toThrow();
  });

  it("makes no network request at all", async () => {
    await generateMarketingContent(contentInput, CTX);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the audit row", () => {
  it("records the attempt without the customer's words", async () => {
    const result = await generateSmartReply(replyInput, CTX);

    expect(result.ok).toBe(true);
    expect(mocks.inserted).toHaveLength(1);

    const row = mocks.inserted[0];
    expect(row).toMatchObject({
      workspace_id: CTX.workspaceId,
      user_id: CTX.userId,
      tool: "smart_reply",
      provider: "mock",
      succeeded: true,
      error_code: null,
    });
    expect(row.latency_ms).toBeTypeOf("number");

    // Structured parameters only - no message, no name, no context, and no
    // generated text either.
    expect(Object.keys(row.input_summary as object).sort()).toEqual([
      "hasContactName",
      "hasContext",
      "language",
      "tone",
    ]);
    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain("kantha");
    expect(serialised).not.toContain("Meera");
    expect(serialised).not.toContain("Diwali");
    expect(row.output).toBeUndefined();
  });

  it("summarises the content tool by its structured knobs", async () => {
    await generateMarketingContent(contentInput, CTX);

    const row = mocks.inserted[0];
    expect(Object.keys(row.input_summary as object).sort()).toEqual([
      "hasDescription",
      "hasImageContext",
      "hasOffer",
      "hasPrice",
      "language",
      "objective",
      "platform",
      "tone",
    ]);
    expect(JSON.stringify(row)).not.toContain("Kantha");
  });

  it("still returns the draft when the audit write fails", async () => {
    mocks.insertError = { code: "PGRST301" };

    const result = await generateSmartReply(replyInput, CTX);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The seller keeps her draft; only the link to the audit row is lost.
    expect(result.data.generationId).toBeNull();
    expect(smartReplyOutputSchema.safeParse(result.data.output).success).toBe(
      true,
    );
  });

  it("returns the generation id so a saved draft can be linked to it", async () => {
    const result = await generateMarketingContent(contentInput, CTX);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.generationId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });
});
