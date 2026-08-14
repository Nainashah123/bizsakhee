import { z } from "zod";

import { toMinorUnits, type CurrencyCode } from "@/lib/money";

/**
 * Product validation.
 *
 * Prices are typed by a human in major units ("1,249.50") and converted to
 * integer minor units here with `toMinorUnits`, so a float never reaches the
 * database. `sale_price_minor <= price_minor` is enforced in this schema as
 * well as by a CHECK constraint in `20260813000400_commerce.sql`.
 */

export const PRODUCT_STATUSES = ["draft", "published", "archived"] as const;
export type ProductStatusValue = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_STATUS_LABELS: Record<ProductStatusValue, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export const STOCK_STATUSES = [
  "in_stock",
  "made_to_order",
  "out_of_stock",
] as const;
export type StockStatusValue = (typeof STOCK_STATUSES)[number];

export const STOCK_STATUS_LABELS: Record<StockStatusValue, string> = {
  in_stock: "In stock",
  made_to_order: "Made to order",
  out_of_stock: "Out of stock",
};

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

export const SLUG_MAX_LENGTH = 80;

/** Mirrors the CHECK constraint on `products.slug`. */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

export function isValidProductSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

/**
 * "Hand-Painted Diyá Set!" -> "hand-painted-diya-set".
 * Returns "" when nothing usable survives (e.g. a fully non-Latin name), which
 * is why callers go through `toProductSlug` for the fallback.
 */
export function slugify(input: string): string {
  const base = input
    .normalize("NFKD")
    // Strip combining marks left behind by the decomposition above.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, "");
}

export const SLUG_FALLBACK = "product";

export function toProductSlug(input: string): string {
  return slugify(input) || SLUG_FALLBACK;
}

/** Truncates `root` so that `root + suffix` still fits the column limit. */
function withSuffix(root: string, suffix: string): string {
  const head = root
    .slice(0, SLUG_MAX_LENGTH - suffix.length)
    .replace(/-+$/g, "");
  return `${head || SLUG_FALLBACK}${suffix}`;
}

/**
 * Picks the first slug not already used inside the workspace: `base`,
 * `base-2`, `base-3`, ... The unique index on `(workspace_id, slug)` remains
 * the real guarantee - this only avoids the round trip in the common case.
 */
export function nextAvailableSlug(
  base: string,
  taken: Iterable<string>,
  options: { maxAttempts?: number; randomSuffix?: () => string } = {},
): string {
  const used = new Set(taken);
  const root = base || SLUG_FALLBACK;
  const maxAttempts = options.maxAttempts ?? 200;

  if (!used.has(root)) return root;

  for (let counter = 2; counter <= maxAttempts; counter += 1) {
    const candidate = withSuffix(root, `-${counter}`);
    if (!used.has(candidate)) return candidate;
  }

  // Pathological case (hundreds of identically named products): fall back to a
  // random suffix rather than looping forever.
  const random =
    options.randomSuffix?.() ?? Math.random().toString(36).slice(2, 8);
  return withSuffix(root, `-${random}`);
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

/** FormData values are strings; anything else is treated as absent. */
function trimmed<Schema extends z.ZodString>(schema: Schema) {
  return z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : ""),
    schema,
  );
}

function optionalText(max: number, message?: string) {
  return trimmed(z.string().max(max, message ?? "That is too long")).transform(
    (value) => (value === "" ? undefined : value),
  );
}

function optionalInteger(max: number) {
  return z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.coerce
      .number()
      .int("Use a whole number")
      .min(0, "Cannot be negative")
      .max(max, "That is too large")
      .optional(),
  );
}

/** Up to 9 integer digits and 2 decimals - enough for every supported currency. */
const MONEY_PATTERN = /^\d{1,9}(?:\.\d{1,2})?$/;

function parseMoney(
  raw: string,
  currency: CurrencyCode,
): { ok: true; minor: number } | { ok: false } {
  const cleaned = raw.replace(/[\s,]/g, "");
  if (!MONEY_PATTERN.test(cleaned)) return { ok: false };
  try {
    return { ok: true, minor: toMinorUnits(cleaned, currency) };
  } catch {
    return { ok: false };
  }
}

const MONEY_MESSAGE = "Enter an amount like 1249.50";

function requiredMoney(currency: CurrencyCode, emptyMessage: string) {
  return trimmed(z.string()).transform((raw, ctx) => {
    if (raw === "") {
      ctx.addIssue({ code: "custom", message: emptyMessage });
      return z.NEVER;
    }
    const parsed = parseMoney(raw, currency);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: MONEY_MESSAGE });
      return z.NEVER;
    }
    return parsed.minor;
  });
}

function optionalMoney(currency: CurrencyCode) {
  return trimmed(z.string()).transform((raw, ctx) => {
    if (raw === "") return undefined;
    const parsed = parseMoney(raw, currency);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: MONEY_MESSAGE });
      return z.NEVER;
    }
    return parsed.minor;
  });
}

const idField = (message: string) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.uuid(message),
  );

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * The currency is a parameter rather than a form field: it comes from the
 * workspace resolved server-side, so a crafted form cannot change how an
 * amount is scaled.
 */
export function productFormSchema(currency: CurrencyCode) {
  return z
    .object({
      name: trimmed(
        z
          .string()
          .min(1, "Give the product a name")
          .max(160, "That name is too long"),
      ),
      slug: optionalText(SLUG_MAX_LENGTH, "That link is too long").refine(
        (value) => value === undefined || isValidProductSlug(value),
        "Use lowercase letters, numbers and hyphens",
      ),
      description: optionalText(
        2000,
        "Keep the description under 2000 characters",
      ),
      sku: optionalText(64, "That code is too long"),
      price: requiredMoney(currency, "Enter a price"),
      salePrice: optionalMoney(currency),
      stockStatus: z.enum(STOCK_STATUSES, { message: "Pick a stock status" }),
      stockQuantity: optionalInteger(1_000_000),
      status: z.enum(PRODUCT_STATUSES, { message: "Pick a status" }),
    })
    .refine(
      (data) => data.salePrice === undefined || data.salePrice <= data.price,
      {
        message: "The sale price cannot be higher than the price",
        path: ["salePrice"],
      },
    );
}

export type ProductFormInput = z.output<ReturnType<typeof productFormSchema>>;

export const productIdSchema = z.object({
  productId: idField("We could not find that product."),
});

export const productStatusSchema = z.object({
  productId: idField("We could not find that product."),
  status: z.enum(PRODUCT_STATUSES, { message: "Pick a status" }),
});

export function variantFormSchema(currency: CurrencyCode) {
  return z.object({
    productId: idField("We could not find that product."),
    variantId: idField("We could not find that option.").optional(),
    name: trimmed(
      z
        .string()
        .min(1, "Give the option a name")
        .max(120, "That name is too long"),
    ),
    sku: optionalText(64, "That code is too long"),
    price: optionalMoney(currency),
    stockQuantity: optionalInteger(1_000_000),
    position: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? 0 : value),
      z.coerce.number().int().min(0).max(999).default(0),
    ),
  });
}

export type VariantFormInput = z.output<ReturnType<typeof variantFormSchema>>;

export const variantIdSchema = z.object({
  productId: idField("We could not find that product."),
  variantId: idField("We could not find that option."),
});

export const IMAGE_INTENTS = [
  "primary",
  "up",
  "down",
  "remove",
  "alt",
] as const;
export type ImageIntent = (typeof IMAGE_INTENTS)[number];

export const productImageActionSchema = z.object({
  productId: idField("We could not find that product."),
  imageId: idField("We could not find that image."),
  intent: z.enum(IMAGE_INTENTS, { message: "Unknown action" }),
  altText: optionalText(160, "Keep the description under 160 characters"),
});

export const productImageUploadSchema = z.object({
  productId: idField("We could not find that product."),
});

/** Query-string filters for the product list. Never touches the database directly. */
export const productListParamsSchema = z.object({
  q: optionalText(80).catch(undefined).optional(),
  status: z.enum(PRODUCT_STATUSES).optional().catch(undefined),
});

export type ProductListParams = z.output<typeof productListParamsSchema>;
