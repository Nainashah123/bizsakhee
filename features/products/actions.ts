"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  allocateProductSlug,
  deleteProductImage,
  deleteVariant,
  createProduct,
  insertProductImage,
  listProductImages,
  moveWithin,
  reorderProductImages,
  saveVariant,
  setProductStatus,
  updateProduct,
  updateProductImageAlt,
} from "@/features/products/service";
import { requireCapability } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { isCurrencyCode, type CurrencyCode } from "@/lib/money";
import { assertWithinLimit } from "@/lib/plans/entitlements";
import {
  discardProductImageObjects,
  uploadProductImageObject,
} from "@/lib/storage/images";
import {
  assertImageBytes,
  readImageDimensions,
  validateProductImageUpload,
} from "@/lib/storage/upload";
import { createClient } from "@/lib/supabase/server";
import { parseFormData } from "@/lib/validation/form";
import {
  productFormSchema,
  productImageActionSchema,
  productImageUploadSchema,
  productStatusSchema,
  variantFormSchema,
  variantIdSchema,
} from "@/lib/validation/products";

/**
 * Product mutations.
 *
 * Every action starts with `requireCapability("products.write")`, which
 * resolves the workspace from the verified session. The workspace id is never
 * read from the submitted form, and every write is additionally scoped with
 * `.eq("workspace_id", workspace.id)` inside the service layer.
 */

export type ProductActionState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  message?: string;
};

const MAX_IMAGES_PER_UPLOAD = 8;
const MAX_IMAGES_PER_PRODUCT = 12;

function currencyOf(value: string): CurrencyCode {
  return isCurrencyCode(value) ? value : "INR";
}

function revalidateProduct(productId: string) {
  revalidatePath("/dashboard/products");
  revalidatePath(`/dashboard/products/${productId}`);
}

// ---------------------------------------------------------------------------
// Create / update / status
// ---------------------------------------------------------------------------

export async function createProductAction(
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const authorized = await requireCapability("products.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const { workspace, user } = authorized.data;
  const parsed = parseFormData(
    productFormSchema(currencyOf(workspace.currency)),
    formData,
  );
  if (!parsed.ok) {
    return {
      error: parsed.error.message,
      fieldErrors: parsed.error.fieldErrors,
    };
  }

  // Plan limit, checked on the server from the plan in force. Being over the
  // limit blocks new products only; the existing catalogue is left alone.
  const withinLimit = await assertWithinLimit(workspace.id, "products");
  if (!withinLimit.ok) return { error: withinLimit.error.message };

  const supabase = await createClient();
  const created = await createProduct(
    supabase,
    { id: workspace.id, currency: workspace.currency },
    user.id,
    parsed.data,
  );

  if (!created.ok) {
    return {
      error: created.error.message,
      fieldErrors: created.error.fieldErrors,
    };
  }

  revalidatePath("/dashboard/products");
  revalidatePath(`/store/${workspace.slug}`);
  redirect(`/dashboard/products/${created.data.id}`);
}

export async function updateProductAction(
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const authorized = await requireCapability("products.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const { workspace } = authorized.data;

  const identity = parseFormData(
    z.object({ productId: z.uuid("We could not find that product.") }),
    formData,
  );
  if (!identity.ok) return { error: identity.error.message };

  const parsed = parseFormData(
    productFormSchema(currencyOf(workspace.currency)),
    formData,
  );
  if (!parsed.ok) {
    return {
      error: parsed.error.message,
      fieldErrors: parsed.error.fieldErrors,
    };
  }

  const supabase = await createClient();
  const updated = await updateProduct(
    supabase,
    workspace.id,
    identity.data.productId,
    parsed.data,
  );

  if (!updated.ok) {
    return {
      error: updated.error.message,
      fieldErrors: updated.error.fieldErrors,
    };
  }

  revalidateProduct(identity.data.productId);
  revalidatePath(`/store/${workspace.slug}`);
  return { message: "Saved." };
}

export async function setProductStatusAction(
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const authorized = await requireCapability("products.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(productStatusSchema, formData);
  if (!parsed.ok) {
    return {
      error: parsed.error.message,
      fieldErrors: parsed.error.fieldErrors,
    };
  }

  const { workspace } = authorized.data;
  const supabase = await createClient();
  const result = await setProductStatus(
    supabase,
    workspace.id,
    parsed.data.productId,
    parsed.data.status,
  );

  if (!result.ok) return { error: result.error.message };

  revalidateProduct(parsed.data.productId);
  revalidatePath(`/store/${workspace.slug}`);

  const messages: Record<typeof parsed.data.status, string> = {
    draft: "Moved back to draft.",
    published: "Published to your catalogue.",
    archived: "Archived.",
  };
  return { message: messages[parsed.data.status] };
}

/** Regenerates the catalogue link from the current name. */
export async function refreshProductSlugAction(
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const authorized = await requireCapability("products.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(
    z.object({
      productId: z.uuid("We could not find that product."),
      name: z.string().trim().min(1, "Give the product a name").max(160),
    }),
    formData,
  );
  if (!parsed.ok) {
    return {
      error: parsed.error.message,
      fieldErrors: parsed.error.fieldErrors,
    };
  }

  const { workspace } = authorized.data;
  const supabase = await createClient();

  const slug = await allocateProductSlug(
    supabase,
    workspace.id,
    parsed.data.name,
    parsed.data.productId,
  );
  if (!slug.ok) return { error: slug.error.message };

  const { error } = await supabase
    .from("products")
    .update({ slug: slug.data })
    .eq("id", parsed.data.productId)
    .eq("workspace_id", workspace.id);

  if (error) {
    logger.error("product_slug_update_failed", { code: error.code });
    return { error: "We could not update that link. Please try again." };
  }

  revalidateProduct(parsed.data.productId);
  return { message: `Link is now /${slug.data}` };
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export async function saveVariantAction(
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const authorized = await requireCapability("products.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const { workspace } = authorized.data;
  const parsed = parseFormData(
    variantFormSchema(currencyOf(workspace.currency)),
    formData,
  );
  if (!parsed.ok) {
    return {
      error: parsed.error.message,
      fieldErrors: parsed.error.fieldErrors,
    };
  }

  const supabase = await createClient();
  const result = await saveVariant(supabase, workspace.id, parsed.data);
  if (!result.ok) {
    return {
      error: result.error.message,
      fieldErrors: result.error.fieldErrors,
    };
  }

  revalidateProduct(parsed.data.productId);
  revalidatePath(`/store/${workspace.slug}`);
  return { message: parsed.data.variantId ? "Option saved." : "Option added." };
}

export async function deleteVariantAction(
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const authorized = await requireCapability("products.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(variantIdSchema, formData);
  if (!parsed.ok) return { error: parsed.error.message };

  const { workspace } = authorized.data;
  const supabase = await createClient();
  const result = await deleteVariant(
    supabase,
    workspace.id,
    parsed.data.productId,
    parsed.data.variantId,
  );
  if (!result.ok) return { error: result.error.message };

  revalidateProduct(parsed.data.productId);
  revalidatePath(`/store/${workspace.slug}`);
  return { message: "Option removed." };
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export async function uploadProductImagesAction(
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const authorized = await requireCapability("products.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(productImageUploadSchema, formData);
  if (!parsed.ok) return { error: parsed.error.message };

  const { workspace } = authorized.data;
  const { productId } = parsed.data;

  const files = formData
    .getAll("images")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (files.length === 0) {
    return { error: "Choose at least one image to upload." };
  }
  if (files.length > MAX_IMAGES_PER_UPLOAD) {
    return { error: `Upload up to ${MAX_IMAGES_PER_UPLOAD} images at a time.` };
  }

  const supabase = await createClient();

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, name")
    .eq("id", productId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (productError) {
    logger.error("product_image_parent_lookup_failed", {
      code: productError.code,
    });
    return { error: "We could not load that product. Please try again." };
  }
  if (!product) return { error: "We could not find that product." };

  const existing = await listProductImages(supabase, workspace.id, productId);
  if (!existing.ok) return { error: existing.error.message };

  if (existing.data.length + files.length > MAX_IMAGES_PER_PRODUCT) {
    return {
      error: `A product can have ${MAX_IMAGES_PER_PRODUCT} images. Remove one first.`,
    };
  }

  let position = existing.data.length;
  let uploaded = 0;

  for (const file of files) {
    const validated = validateProductImageUpload({
      file: { name: file.name, size: file.size, type: file.type },
      // Resolved from the session above - never from the submitted form.
      workspaceId: workspace.id,
      productId,
      allowedWorkspaceIds: [workspace.id],
    });

    if (!validated.ok) {
      return {
        error: `${file.name}: ${validated.error.message}`,
        message: uploaded > 0 ? `${uploaded} image(s) uploaded.` : undefined,
      };
    }

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // The declared MIME type is only a hint; the header has to agree.
    const sniffed = assertImageBytes(bytes, validated.data.mimeType);
    if (!sniffed.ok) {
      return {
        error: `${file.name}: ${sniffed.error.message}`,
        message: uploaded > 0 ? `${uploaded} image(s) uploaded.` : undefined,
      };
    }

    const stored = await uploadProductImageObject(supabase, {
      path: validated.data.path,
      mimeType: validated.data.mimeType,
      body: buffer,
    });
    if (!stored.ok) return { error: `${file.name}: ${stored.error.message}` };

    const dimensions = readImageDimensions(bytes);

    const inserted = await insertProductImage(supabase, workspace.id, {
      productId,
      storagePath: validated.data.path,
      mimeType: validated.data.mimeType,
      byteSize: validated.data.byteSize,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      position,
      altText: product.name,
    });

    if (!inserted.ok) {
      // The row is the source of truth; do not leave an orphaned object.
      await discardProductImageObjects(supabase, [validated.data.path]);
      return { error: `${file.name}: ${inserted.error.message}` };
    }

    position += 1;
    uploaded += 1;
  }

  revalidateProduct(productId);
  revalidatePath(`/store/${workspace.slug}`);
  return {
    message: uploaded === 1 ? "Image added." : `${uploaded} images added.`,
  };
}

export async function manageProductImageAction(
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const authorized = await requireCapability("products.write");
  if (!authorized.ok) return { error: authorized.error.message };

  const parsed = parseFormData(productImageActionSchema, formData);
  if (!parsed.ok) {
    return {
      error: parsed.error.message,
      fieldErrors: parsed.error.fieldErrors,
    };
  }

  const { workspace } = authorized.data;
  const { productId, imageId, intent } = parsed.data;
  const supabase = await createClient();

  if (intent === "remove") {
    const removed = await deleteProductImage(
      supabase,
      workspace.id,
      productId,
      imageId,
    );
    if (!removed.ok) return { error: removed.error.message };

    // Close the gap left in the ordering so position 0 always exists.
    const remaining = await listProductImages(
      supabase,
      workspace.id,
      productId,
    );
    if (remaining.ok) {
      await reorderProductImages(
        supabase,
        workspace.id,
        productId,
        remaining.data.map((image) => image.id),
      );
    }

    revalidateProduct(productId);
    revalidatePath(`/store/${workspace.slug}`);
    return {
      message: removed.data.objectRemoved
        ? "Image removed."
        : "Image removed. The stored file will be cleaned up shortly.",
    };
  }

  if (intent === "alt") {
    const result = await updateProductImageAlt(
      supabase,
      workspace.id,
      productId,
      imageId,
      parsed.data.altText ?? null,
    );
    if (!result.ok) return { error: result.error.message };

    revalidateProduct(productId);
    revalidatePath(`/store/${workspace.slug}`);
    return { message: "Description saved." };
  }

  const images = await listProductImages(supabase, workspace.id, productId);
  if (!images.ok) return { error: images.error.message };

  const ordered = moveWithin(
    images.data.map((image) => image.id),
    imageId,
    intent,
  );
  if (!ordered) return { message: "Already in that position." };

  const reordered = await reorderProductImages(
    supabase,
    workspace.id,
    productId,
    ordered,
  );
  if (!reordered.ok) return { error: reordered.error.message };

  revalidateProduct(productId);
  revalidatePath(`/store/${workspace.slug}`);
  return {
    message: intent === "primary" ? "Set as the main image." : "Order updated.",
  };
}
