import "server-only";

import { cache } from "react";

import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

/**
 * Public catalogue reads.
 *
 * This runs for anonymous visitors, so the guarantees are stated twice:
 * the RLS policies in `20260813000900_rls_policies.sql` only expose published
 * products of an opted-in workspace, and every query below repeats the
 * `status = 'published'` and `is_catalogue_public` conditions explicitly.
 * A drafted or archived product must never be reachable here, and a
 * policy-only defence would be one migration away from a leak.
 */

export type CatalogueVariant = {
  id: string;
  name: string;
  priceMinor: number | null;
};

export type CatalogueImage = {
  storagePath: string;
  altText: string | null;
  width: number | null;
  height: number | null;
};

export type CatalogueProduct = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priceMinor: number;
  salePriceMinor: number | null;
  currency: string;
  stockStatus: "in_stock" | "made_to_order" | "out_of_stock";
  image: CatalogueImage | null;
  variants: CatalogueVariant[];
};

export type PublicCatalogue = {
  workspace: { id: string; name: string; slug: string; currency: string };
  business: {
    businessName: string;
    city: string | null;
    description: string | null;
    whatsappNumber: string | null;
    instagramHandle: string | null;
  } | null;
  products: CatalogueProduct[];
};

/**
 * Resolves a catalogue by workspace slug. Returns null when the workspace does
 * not exist or has not opted in - the caller turns that into `notFound()`, so
 * a private catalogue is indistinguishable from a missing one.
 */
export const getPublicCatalogue = cache(
  async (workspaceSlug: string): Promise<PublicCatalogue | null> => {
    const slug = workspaceSlug.trim().toLowerCase();
    if (!slug || slug.length > 80 || !/^[a-z0-9-]+$/.test(slug)) return null;

    const supabase = await createClient();

    const { data: workspace, error } = await supabase
      .from("workspaces")
      .select("id, name, slug, currency, is_catalogue_public")
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      logger.error("catalogue_workspace_lookup_failed", { code: error.code });
      return null;
    }
    if (!workspace || !workspace.is_catalogue_public) return null;

    const [businessResult, productsResult] = await Promise.all([
      supabase
        .from("business_profiles")
        .select(
          "business_name, city, description, whatsapp_number, instagram_handle",
        )
        .eq("workspace_id", workspace.id)
        .maybeSingle(),
      supabase
        .from("products")
        .select(
          "id, name, slug, description, price_minor, sale_price_minor, currency, stock_status, position, created_at",
        )
        .eq("workspace_id", workspace.id)
        // Security requirement, asserted here and not only in RLS.
        .eq("status", "published")
        .order("position", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    if (productsResult.error) {
      logger.error("catalogue_products_failed", {
        code: productsResult.error.code,
      });
      return null;
    }

    const rows = productsResult.data ?? [];
    const ids = rows.map((row) => row.id);

    const [imagesResult, variantsResult] = await Promise.all([
      loadImages(supabase, workspace.id, ids),
      loadVariants(supabase, workspace.id, ids),
    ]);

    const products: CatalogueProduct[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      priceMinor: Number(row.price_minor),
      salePriceMinor:
        row.sale_price_minor === null ? null : Number(row.sale_price_minor),
      currency: row.currency,
      stockStatus: row.stock_status,
      image: imagesResult.get(row.id) ?? null,
      variants: variantsResult.get(row.id) ?? [],
    }));

    const business = businessResult.data
      ? {
          businessName: businessResult.data.business_name,
          city: businessResult.data.city,
          description: businessResult.data.description,
          whatsappNumber: businessResult.data.whatsapp_number,
          instagramHandle: businessResult.data.instagram_handle,
        }
      : null;

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        currency: workspace.currency,
      },
      business,
      products,
    };
  },
);

type Client = Awaited<ReturnType<typeof createClient>>;

async function loadImages(
  supabase: Client,
  workspaceId: string,
  productIds: string[],
): Promise<Map<string, CatalogueImage>> {
  const byProduct = new Map<string, CatalogueImage>();
  if (productIds.length === 0) return byProduct;

  const { data } = await supabase
    .from("product_images")
    .select("product_id, storage_path, alt_text, width, height, position")
    .eq("workspace_id", workspaceId)
    .in("product_id", productIds)
    .order("position", { ascending: true });

  for (const image of data ?? []) {
    // Position 0 arrives first, so the first row per product is the primary.
    if (!byProduct.has(image.product_id)) {
      byProduct.set(image.product_id, {
        storagePath: image.storage_path,
        altText: image.alt_text,
        width: image.width,
        height: image.height,
      });
    }
  }

  return byProduct;
}

async function loadVariants(
  supabase: Client,
  workspaceId: string,
  productIds: string[],
): Promise<Map<string, CatalogueVariant[]>> {
  const byProduct = new Map<string, CatalogueVariant[]>();
  if (productIds.length === 0) return byProduct;

  const { data } = await supabase
    .from("product_variants")
    .select("id, product_id, name, price_minor, position")
    .eq("workspace_id", workspaceId)
    .in("product_id", productIds)
    .order("position", { ascending: true });

  for (const variant of data ?? []) {
    const list = byProduct.get(variant.product_id) ?? [];
    list.push({
      id: variant.id,
      name: variant.name,
      priceMinor:
        variant.price_minor === null ? null : Number(variant.price_minor),
    });
    byProduct.set(variant.product_id, list);
  }

  return byProduct;
}
