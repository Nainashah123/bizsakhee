import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AI_TOOLS,
  OUTPUT_SCHEMA_BY_TOOL,
  contentInputSchema,
  contentOutputSchema,
  smartReplyInputSchema,
  smartReplyOutputSchema,
} from "@/lib/ai/schemas";

/**
 * The AI contracts.
 *
 * Input schemas guard what a Route Handler accepts; output schemas guard what a
 * model is allowed to put on a seller's screen. Both are exercised here on the
 * failure paths, because those are the ones that matter: a caption that arrives
 * without a caption, or a "hashtag" with a space in it, must be refused rather
 * than rendered best-effort.
 */

const paths = (issues: { path: PropertyKey[] }[]) =>
  issues.map((issue) => issue.path.join("."));

describe("smartReplyInputSchema", () => {
  it("applies the documented defaults when only a message is sent", () => {
    const parsed = smartReplyInputSchema.parse({
      customerMessage: "  Do you have this in red?  ",
    });

    expect(parsed).toEqual({
      customerMessage: "Do you have this in red?",
      tone: "friendly",
      language: "en",
    });
  });

  it("rejects a missing message on the customerMessage path", () => {
    const result = smartReplyInputSchema.safeParse({});

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(paths(result.error.issues)).toContain("customerMessage");
  });

  it("rejects a whitespace-only message with the seller-facing message", () => {
    const result = smartReplyInputSchema.safeParse({ customerMessage: "   " });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].path.join(".")).toBe("customerMessage");
    expect(result.error.issues[0].message).toBe("Paste the customer's message");
  });

  it("rejects a message over the 2,000 character limit", () => {
    const result = smartReplyInputSchema.safeParse({
      customerMessage: "x".repeat(2_001),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find(
      (candidate) => candidate.path.join(".") === "customerMessage",
    );
    expect(issue?.message).toBe(
      "That message is too long to draft a reply for",
    );
  });

  it("accepts exactly 2,000 characters", () => {
    expect(
      smartReplyInputSchema.safeParse({ customerMessage: "x".repeat(2_000) })
        .success,
    ).toBe(true);
  });

  it("rejects a tone or language outside the allowed set", () => {
    const result = smartReplyInputSchema.safeParse({
      customerMessage: "hi",
      tone: "sarcastic",
      language: "fr",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(paths(result.error.issues).sort()).toEqual(["language", "tone"]);
  });

  it("strips unknown keys rather than failing, so a crafted body cannot smuggle a workspace id", () => {
    // Documented behaviour of the bare object schema. The Route Handlers wrap
    // it in `z.strictObject(shape)` so unknown keys are refused at the edge;
    // this asserts the schema itself never lets one through to a service.
    const parsed = smartReplyInputSchema.parse({
      customerMessage: "hi",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      isAdmin: true,
    });

    expect(parsed).not.toHaveProperty("workspaceId");
    expect(parsed).not.toHaveProperty("isAdmin");
    expect(Object.keys(parsed).sort()).toEqual([
      "customerMessage",
      "language",
      "tone",
    ]);
  });

  it("refuses unknown keys once wrapped the way the Route Handler wraps it", () => {
    // `app/api/ai/reply/route.ts` builds its body schema this way so an unknown
    // key is a 422 rather than a silent drop.
    const strict = z.strictObject(smartReplyInputSchema.shape);

    const rejected = strict.safeParse({
      customerMessage: "hi",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    expect(rejected.success).toBe(false);

    // Wrapping must not cost the defaults.
    expect(strict.parse({ customerMessage: "hi" })).toEqual({
      customerMessage: "hi",
      tone: "friendly",
      language: "en",
    });
  });
});

describe("contentInputSchema", () => {
  it("rejects a missing product name on the productName path", () => {
    const result = contentInputSchema.safeParse({ platform: "instagram" });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(paths(result.error.issues)).toContain("productName");
  });

  it("uses the seller-facing message for an empty product name", () => {
    const result = contentInputSchema.safeParse({ productName: "  " });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].message).toBe("Which product is this for?");
  });

  it("defaults platform, objective, tone and language", () => {
    const parsed = contentInputSchema.parse({ productName: "Kantha saree" });

    expect(parsed.platform).toBe("instagram");
    expect(parsed.objective).toBe("announce_product");
    expect(parsed.tone).toBe("friendly");
    expect(parsed.language).toBe("en");
  });

  it("rejects an over-length product description", () => {
    const result = contentInputSchema.safeParse({
      productName: "Kantha saree",
      productDescription: "x".repeat(601),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(paths(result.error.issues)).toContain("productDescription");
  });
});

describe("smartReplyOutputSchema", () => {
  it("accepts a reply with no follow-up question", () => {
    const parsed = smartReplyOutputSchema.parse({
      reply: "Yes, I have it in red. Shall I set one aside for you?",
    });

    expect(parsed.followUpQuestion).toBeUndefined();
  });

  it("rejects an empty reply", () => {
    const result = smartReplyOutputSchema.safeParse({ reply: "   " });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(paths(result.error.issues)).toContain("reply");
  });

  it("rejects a reply longer than a message anyone would send", () => {
    const result = smartReplyOutputSchema.safeParse({
      reply: "x".repeat(1_201),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(paths(result.error.issues)).toContain("reply");
  });
});

describe("contentOutputSchema", () => {
  const valid = {
    hook: "Back in stock: the kantha saree",
    caption: "Three weeks of hand stitching, and it is finally ready.",
    callToAction: "Message me on WhatsApp to order.",
    hashtags: ["#kantha", "#handmade", "#कपड", "#slow_fashion", "#shop2026"],
    whatsappMessage: "The kantha saree is back. Reply here if you want one.",
  };

  it("accepts a complete response, including non-Latin and underscored hashtags", () => {
    expect(contentOutputSchema.parse(valid)).toEqual(valid);
  });

  it("documents that the regex rejects Indic combining marks", () => {
    // `\p{L}\p{N}` does not include `\p{M}`, so a vowel sign (मात्रा) or nukta
    // fails the check - "#साड़ी" is rejected even though it is a perfectly
    // ordinary Hindi hashtag. Asserted here so the limitation is visible rather
    // than discovered by a seller writing in Hindi. Widening the pattern is a
    // change to the committed contract in `lib/ai/schemas.ts`.
    const result = contentOutputSchema.safeParse({
      ...valid,
      hashtags: ["#साड़ी"],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(paths(result.error.issues)).toEqual(["hashtags.0"]);
  });

  it("REJECTS a response that is missing the caption", () => {
    const { caption: _omitted, ...withoutCaption } = valid;
    const result = contentOutputSchema.safeParse(withoutCaption);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(paths(result.error.issues)).toEqual(["caption"]);
  });

  it("REJECTS a hashtag with no leading hash", () => {
    const result = contentOutputSchema.safeParse({
      ...valid,
      hashtags: ["#kantha", "no-hash"],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(paths(result.error.issues)).toEqual(["hashtags.1"]);
    expect(result.error.issues[0].message).toBe(
      "Hashtags must start with # and have no spaces",
    );
  });

  it("REJECTS a hashtag containing a space", () => {
    const result = contentOutputSchema.safeParse({
      ...valid,
      hashtags: ["#has space"],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(paths(result.error.issues)).toEqual(["hashtags.0"]);
  });

  it("rejects more than fifteen hashtags", () => {
    const result = contentOutputSchema.safeParse({
      ...valid,
      hashtags: Array.from({ length: 16 }, (_, index) => `#tag${index}`),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(paths(result.error.issues)).toEqual(["hashtags"]);
  });

  it("strips unknown keys a model volunteers", () => {
    const parsed = contentOutputSchema.parse({
      ...valid,
      confidence: 0.98,
      suggestedPrice: "Rs 999",
    });

    expect(parsed).not.toHaveProperty("confidence");
    expect(parsed).not.toHaveProperty("suggestedPrice");
  });
});

describe("OUTPUT_SCHEMA_BY_TOOL", () => {
  it("covers every declared tool", () => {
    expect(Object.keys(OUTPUT_SCHEMA_BY_TOOL).sort()).toEqual(
      [...AI_TOOLS].sort(),
    );
  });

  it("maps each tool to the schema that actually validates its output", () => {
    expect(
      OUTPUT_SCHEMA_BY_TOOL.smart_reply.safeParse({ reply: "Sure!" }).success,
    ).toBe(true);
    expect(
      OUTPUT_SCHEMA_BY_TOOL.content_generator.safeParse({ reply: "Sure!" })
        .success,
    ).toBe(false);
  });
});
