import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { err, ok, type Result } from "@/lib/result";
import { PRODUCT_IMAGE_BUCKET } from "@/lib/storage/paths";
import type { Database } from "@/lib/supabase/database.types";
import type { ProductImageMime } from "@/lib/storage/upload";

type Client = SupabaseClient<Database>;

/**
 * Supabase Storage glue for product images.
 *
 * Object writes and the `product_images` row are two separate systems with no
 * shared transaction, so the ordering rules are explicit:
 *   - upload the object first, then insert the row; if the row fails, the
 *     orphaned object is removed (`discardProductImageObjects`),
 *   - on delete, remove the row first (it is what the UI reads) and then make
 *     a best-effort attempt at the object. A storage failure is logged and
 *     swallowed so a transient Storage outage never leaves a dangling row.
 */

export async function uploadProductImageObject(
  supabase: Client,
  input: { path: string; mimeType: ProductImageMime; body: ArrayBuffer },
): Promise<Result<{ path: string }>> {
  const { error } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(input.path, input.body, {
      contentType: input.mimeType,
      // The path already contains a fresh UUID, so an overwrite would mean
      // something is badly wrong - fail loudly instead of clobbering.
      upsert: false,
    });

  if (error) {
    logger.error("product_image_upload_failed", { message: error.message });
    return err(
      "upstream_error",
      "We could not store that image. Please try again.",
    );
  }

  return ok({ path: input.path });
}

/**
 * Best-effort object removal. Returns whether storage confirmed the delete;
 * callers treat `false` as "log it and carry on", never as a failed operation.
 */
export async function discardProductImageObjects(
  supabase: Client,
  paths: readonly string[],
): Promise<boolean> {
  if (paths.length === 0) return true;

  try {
    const { error } = await supabase.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .remove([...paths]);

    if (error) {
      logger.warn("product_image_object_delete_failed", {
        message: error.message,
        count: paths.length,
      });
      return false;
    }
    return true;
  } catch (cause) {
    logger.warn("product_image_object_delete_threw", {
      count: paths.length,
      error: cause instanceof Error ? cause.message : "unknown",
    });
    return false;
  }
}
