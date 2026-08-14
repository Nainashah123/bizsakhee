import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { err, ok, type Result } from "@/lib/result";
import { discardProductImageObjects } from "@/lib/storage/images";
import type { Database, ProductImageRow } from "@/lib/supabase/database.types";
import {
  nextAvailableSlug,
  toProductSlug,
  type ProductFormInput,
  type ProductStatusValue,
  type VariantFormInput,
} from "@/lib/validation/products";

type Client = SupabaseClient<Database>;

/** Postgres unique violation. */
const UNIQUE_VIOLATION = "23505";

/**
 * Turns a Postgres error into a message a customer can act on, without ever
 * putting the driver's text on screen.
 */
function describeWriteError(
  error: PostgrestError,
  event: string,
): ReturnType<typeof err> {
  logger.error(event, { code: error.code });

  if (error.code === UNIQUE_VIOLATION) {
    return err(
      "conflict",
      "Another product already uses that code. Pick a different SKU.",
    );
  }
  if (error.code === "23514") {
    return err(
      "validation",
      "Those values are not allowed. Check the price and stock fields.",
    );
  }
  return err("unknown", "We could not save that. Please try again.");
}

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

/**
 * Reserves a catalogue link that is unique inside the workspace.
 *
 * The `(workspace_id, slug)` unique index is the real guarantee; this only
 * finds a free candidate up front so the common case is a single insert.
 */
export async function allocateProductSlug(
  supabase: Client,
  workspaceId: string,
  desired: string,
  excludeProductId?: string,
): Promise<Result<string>> {
  const base = toProductSlug(desired);

  // `base` only ever contains [a-z0-9-], so it cannot smuggle a LIKE wildcard.
  const { data, error } = await supabase
    .from("products")
    .select("id, slug")
    .eq("workspace_id", workspaceId)
    .like("slug", `${base}%`);

  if (error) {
    logger.error("product_slug_lookup_failed", { code: error.code });
    return err("unknown", "We could not prepare that product. Please retry.");
  }

  const taken = (data ?? [])
    .filter((row) => row.id !== excludeProductId)
    .map((row) => row.slug);

  return ok(nextAvailableSlug(base, taken));
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export type CreatedProduct = { id: string; slug: string };

export async function createProduct(
  supabase: Client,
  workspace: { id: string; currency: string },
  userId: string,
  input: ProductFormInput,
): Promise<Result<CreatedProduct>> {
  const desired = input.slug ?? input.name;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = await allocateProductSlug(supabase, workspace.id, desired);
    if (!slug.ok) return slug;

    const { data, error } = await supabase
      .from("products")
      .insert({
        workspace_id: workspace.id,
        name: input.name,
        slug: slug.data,
        description: input.description ?? null,
        sku: input.sku ?? null,
        price_minor: input.price,
        sale_price_minor: input.salePrice ?? null,
        currency: workspace.currency,
        stock_status: input.stockStatus,
        stock_quantity: input.stockQuantity ?? null,
        status: input.status,
        created_by: userId,
      })
      .select("id, slug")
      .single();

    if (!error && data) return ok({ id: data.id, slug: data.slug });

    if (error?.code === UNIQUE_VIOLATION && error.message.includes("slug")) {
      // Someone claimed the slug between the lookup and the insert; retry.
      continue;
    }

    if (error) return describeWriteError(error, "product_insert_failed");
  }

  return err("conflict", "That catalogue link is taken. Try another name.");
}

export async function updateProduct(
  supabase: Client,
  workspaceId: string,
  productId: string,
  input: ProductFormInput,
): Promise<Result<CreatedProduct>> {
  const { data: existing, error: readError } = await supabase
    .from("products")
    .select("id, slug")
    .eq("id", productId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (readError) {
    logger.error("product_read_failed", { code: readError.code });
    return err("unknown", "We could not load that product. Please retry.");
  }
  if (!existing) return err("not_found", "We could not find that product.");

  // Only re-slug when the requested link actually differs from the stored one.
  let slug = existing.slug;
  const desired = input.slug ?? input.name;
  const wanted = toProductSlug(desired);
  const isSameFamily =
    existing.slug === wanted || existing.slug.startsWith(`${wanted}-`);

  if (!isSameFamily) {
    const allocated = await allocateProductSlug(
      supabase,
      workspaceId,
      desired,
      productId,
    );
    if (!allocated.ok) return allocated;
    slug = allocated.data;
  }

  const { error } = await supabase
    .from("products")
    .update({
      name: input.name,
      slug,
      description: input.description ?? null,
      sku: input.sku ?? null,
      price_minor: input.price,
      sale_price_minor: input.salePrice ?? null,
      stock_status: input.stockStatus,
      stock_quantity: input.stockQuantity ?? null,
      status: input.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", productId)
    .eq("workspace_id", workspaceId);

  if (error) return describeWriteError(error, "product_update_failed");

  return ok({ id: productId, slug });
}

export async function setProductStatus(
  supabase: Client,
  workspaceId: string,
  productId: string,
  status: ProductStatusValue,
): Promise<Result<{ id: string; status: ProductStatusValue }>> {
  const { data, error } = await supabase
    .from("products")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", productId)
    .eq("workspace_id", workspaceId)
    .select("id")
    .maybeSingle();

  if (error) return describeWriteError(error, "product_status_update_failed");
  if (!data) return err("not_found", "We could not find that product.");

  return ok({ id: data.id, status });
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export async function saveVariant(
  supabase: Client,
  workspaceId: string,
  input: VariantFormInput,
): Promise<Result<{ id: string }>> {
  // Confirm the parent belongs to this workspace before writing a child row.
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id")
    .eq("id", input.productId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (productError) {
    logger.error("variant_parent_lookup_failed", { code: productError.code });
    return err("unknown", "We could not save that option. Please retry.");
  }
  if (!product) return err("not_found", "We could not find that product.");

  const values = {
    name: input.name,
    sku: input.sku ?? null,
    price_minor: input.price ?? null,
    stock_quantity: input.stockQuantity ?? null,
    position: input.position,
    updated_at: new Date().toISOString(),
  };

  if (input.variantId) {
    const { data, error } = await supabase
      .from("product_variants")
      .update(values)
      .eq("id", input.variantId)
      .eq("product_id", input.productId)
      .eq("workspace_id", workspaceId)
      .select("id")
      .maybeSingle();

    if (error) return describeWriteError(error, "variant_update_failed");
    if (!data) return err("not_found", "We could not find that option.");
    return ok({ id: data.id });
  }

  const { data, error } = await supabase
    .from("product_variants")
    .insert({
      workspace_id: workspaceId,
      product_id: input.productId,
      ...values,
    })
    .select("id")
    .single();

  if (error) return describeWriteError(error, "variant_insert_failed");
  return ok({ id: data.id });
}

export async function deleteVariant(
  supabase: Client,
  workspaceId: string,
  productId: string,
  variantId: string,
): Promise<Result<{ id: string }>> {
  const { data, error } = await supabase
    .from("product_variants")
    .delete()
    .eq("id", variantId)
    .eq("product_id", productId)
    .eq("workspace_id", workspaceId)
    .select("id")
    .maybeSingle();

  if (error) return describeWriteError(error, "variant_delete_failed");
  if (!data) return err("not_found", "We could not find that option.");
  return ok({ id: data.id });
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export type NewProductImage = {
  productId: string;
  storagePath: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  position: number;
  altText: string | null;
};

export async function insertProductImage(
  supabase: Client,
  workspaceId: string,
  input: NewProductImage,
): Promise<Result<{ id: string }>> {
  const { data, error } = await supabase
    .from("product_images")
    .insert({
      workspace_id: workspaceId,
      product_id: input.productId,
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      byte_size: input.byteSize,
      width: input.width,
      height: input.height,
      position: input.position,
      alt_text: input.altText,
    })
    .select("id")
    .single();

  if (error) return describeWriteError(error, "product_image_insert_failed");
  return ok({ id: data.id });
}

export async function listProductImages(
  supabase: Client,
  workspaceId: string,
  productId: string,
): Promise<Result<ProductImageRow[]>> {
  const { data, error } = await supabase
    .from("product_images")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("product_id", productId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    logger.error("product_image_list_failed", { code: error.code });
    return err("unknown", "We could not load those images. Please retry.");
  }
  return ok(data ?? []);
}

/**
 * Removes the row first (that is what every read path uses) and only then the
 * stored object. A storage failure is logged, not surfaced: the alternative -
 * failing the whole action - would leave a row pointing at an image the user
 * believes they deleted.
 */
export async function deleteProductImage(
  supabase: Client,
  workspaceId: string,
  productId: string,
  imageId: string,
): Promise<Result<{ id: string; objectRemoved: boolean }>> {
  const { data, error } = await supabase
    .from("product_images")
    .delete()
    .eq("id", imageId)
    .eq("product_id", productId)
    .eq("workspace_id", workspaceId)
    .select("id, storage_path")
    .maybeSingle();

  if (error) return describeWriteError(error, "product_image_delete_failed");
  if (!data) return err("not_found", "We could not find that image.");

  const objectRemoved = await discardProductImageObjects(supabase, [
    data.storage_path,
  ]);

  return ok({ id: data.id, objectRemoved });
}

/**
 * Writes the given order as positions 0..n-1. Position 0 is the primary image,
 * which is the one the catalogue card and the dashboard list show.
 */
export async function reorderProductImages(
  supabase: Client,
  workspaceId: string,
  productId: string,
  orderedImageIds: readonly string[],
): Promise<Result<{ count: number }>> {
  for (const [position, imageId] of orderedImageIds.entries()) {
    const { error } = await supabase
      .from("product_images")
      .update({ position })
      .eq("id", imageId)
      .eq("product_id", productId)
      .eq("workspace_id", workspaceId);

    if (error) return describeWriteError(error, "product_image_reorder_failed");
  }

  return ok({ count: orderedImageIds.length });
}

/** Moves one image within the current ordering and persists the new positions. */
export function moveWithin(
  ids: readonly string[],
  imageId: string,
  intent: "primary" | "up" | "down",
): string[] | null {
  const index = ids.indexOf(imageId);
  if (index < 0) return null;

  const next = [...ids];
  if (intent === "primary") {
    if (index === 0) return null;
    next.splice(index, 1);
    next.unshift(imageId);
    return next;
  }

  const target = intent === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= next.length) return null;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export async function updateProductImageAlt(
  supabase: Client,
  workspaceId: string,
  productId: string,
  imageId: string,
  altText: string | null,
): Promise<Result<{ id: string }>> {
  const { data, error } = await supabase
    .from("product_images")
    .update({ alt_text: altText })
    .eq("id", imageId)
    .eq("product_id", productId)
    .eq("workspace_id", workspaceId)
    .select("id")
    .maybeSingle();

  if (error) return describeWriteError(error, "product_image_alt_failed");
  if (!data) return err("not_found", "We could not find that image.");
  return ok({ id: data.id });
}
