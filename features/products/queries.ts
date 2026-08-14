import "server-only";

import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import type {
  ProductImageRow,
  ProductRow,
  ProductVariantRow,
} from "@/lib/supabase/database.types";
import type {
  ProductListParams,
  ProductStatusValue,
} from "@/lib/validation/products";

/**
 * Product reads for the dashboard.
 *
 * Every query carries `.eq("workspace_id", ...)` in addition to RLS, and no
 * query uses a PostgREST embedded select - images and variants are fetched
 * separately and joined in TypeScript.
 */

export type ProductListItem = {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  priceMinor: number;
  salePriceMinor: number | null;
  currency: string;
  status: ProductStatusValue;
  stockStatus: ProductRow["stock_status"];
  stockQuantity: number | null;
  updatedAt: string;
  imagePath: string | null;
  imageAlt: string | null;
  variantCount: number;
};

export type ProductListResult = {
  items: ProductListItem[];
  counts: { all: number; draft: number; published: number; archived: number };
  /** True when the workspace has no products at all, filters aside. */
  isEmptyWorkspace: boolean;
  failed: boolean;
};

const LIST_LIMIT = 200;

/**
 * PostgREST `or=` takes a comma-separated filter list, so a raw search term
 * could otherwise inject extra filters. Only characters that cannot change the
 * grammar survive.
 */
function sanitizeSearch(term: string): string {
  return term
    .replace(/[^\p{L}\p{N} _-]/gu, " ")
    .trim()
    .slice(0, 60);
}

export async function listProducts(
  workspaceId: string,
  params: ProductListParams = {},
): Promise<ProductListResult> {
  const supabase = await createClient();

  let query = supabase
    .from("products")
    .select("*")
    .eq("workspace_id", workspaceId);

  if (params.status) {
    query = query.eq("status", params.status);
  }

  const search = params.q ? sanitizeSearch(params.q) : "";
  if (search) {
    query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
  }

  const [productsResult, allCount, draftCount, publishedCount, archivedCount] =
    await Promise.all([
      query
        .order("status", { ascending: true })
        .order("updated_at", { ascending: false })
        .limit(LIST_LIMIT),
      countByStatus(workspaceId),
      countByStatus(workspaceId, "draft"),
      countByStatus(workspaceId, "published"),
      countByStatus(workspaceId, "archived"),
    ]);

  if (productsResult.error) {
    logger.error("product_list_failed", { code: productsResult.error.code });
    return {
      items: [],
      counts: { all: 0, draft: 0, published: 0, archived: 0 },
      isEmptyWorkspace: false,
      failed: true,
    };
  }

  const products = (productsResult.data ?? []) as ProductRow[];
  const ids = products.map((product) => product.id);

  const [images, variants] = await Promise.all([
    ids.length
      ? supabase
          .from("product_images")
          .select("product_id, storage_path, alt_text, position")
          .eq("workspace_id", workspaceId)
          .in("product_id", ids)
          .order("position", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase
          .from("product_variants")
          .select("product_id")
          .eq("workspace_id", workspaceId)
          .in("product_id", ids)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const primaryImage = new Map<
    string,
    { storage_path: string; alt_text: string | null }
  >();
  for (const image of images.data ?? []) {
    if (!primaryImage.has(image.product_id)) {
      primaryImage.set(image.product_id, {
        storage_path: image.storage_path,
        alt_text: image.alt_text,
      });
    }
  }

  const variantCounts = new Map<string, number>();
  for (const variant of variants.data ?? []) {
    variantCounts.set(
      variant.product_id,
      (variantCounts.get(variant.product_id) ?? 0) + 1,
    );
  }

  const items: ProductListItem[] = products.map((product) => {
    const image = primaryImage.get(product.id);
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      priceMinor: Number(product.price_minor),
      salePriceMinor:
        product.sale_price_minor === null
          ? null
          : Number(product.sale_price_minor),
      currency: product.currency,
      status: product.status,
      stockStatus: product.stock_status,
      stockQuantity: product.stock_quantity,
      updatedAt: product.updated_at,
      imagePath: image?.storage_path ?? null,
      imageAlt: image?.alt_text ?? null,
      variantCount: variantCounts.get(product.id) ?? 0,
    };
  });

  const counts = {
    all: allCount,
    draft: draftCount,
    published: publishedCount,
    archived: archivedCount,
  };

  return { items, counts, isEmptyWorkspace: counts.all === 0, failed: false };
}

async function countByStatus(
  workspaceId: string,
  status?: ProductStatusValue,
): Promise<number> {
  const supabase = await createClient();
  let query = supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  if (status) query = query.eq("status", status);

  const { count } = await query;
  return count ?? 0;
}

export type ProductDetail = {
  product: ProductRow;
  variants: ProductVariantRow[];
  images: ProductImageRow[];
};

export async function getProductDetail(
  workspaceId: string,
  productId: string,
): Promise<ProductDetail | null> {
  const supabase = await createClient();

  const { data: product, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    logger.error("product_detail_failed", { code: error.code });
    return null;
  }
  if (!product) return null;

  const [variants, images] = await Promise.all([
    supabase
      .from("product_variants")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("product_id", productId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("product_images")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("product_id", productId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  return {
    product: product as ProductRow,
    variants: (variants.data ?? []) as ProductVariantRow[],
    images: (images.data ?? []) as ProductImageRow[],
  };
}
