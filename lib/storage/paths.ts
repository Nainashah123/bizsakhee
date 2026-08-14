/**
 * Storage object paths.
 *
 * The first path segment is always the tenant id, because that is exactly what
 * the storage policies in `20260813001000_storage.sql` authorise against:
 *
 *   product-images/<workspace_id>/<product_id>/<random>.<ext>
 *
 * Getting this shape wrong does not merely look untidy - it makes the upload
 * fail the RLS `with check`, or (worse) lets an object land under a folder the
 * uploader does not own. Nothing else builds these strings by hand.
 */

export const PRODUCT_IMAGE_BUCKET = "product-images";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export type ProductImagePathParts = {
  workspaceId: string;
  productId: string;
  /** Lowercase, without the leading dot. */
  extension: string;
  /** Collision-resistant object name; defaults to `crypto.randomUUID()`. */
  objectId?: string;
};

export function randomObjectId(): string {
  return crypto.randomUUID();
}

export function productImageObjectPath({
  workspaceId,
  productId,
  extension,
  objectId,
}: ProductImagePathParts): string {
  return `${workspaceId}/${productId}/${objectId ?? randomObjectId()}.${extension}`;
}

/** Inverse of `productImageObjectPath`; returns null for anything unexpected. */
export function parseProductImagePath(path: string): {
  workspaceId: string;
  productId: string;
  fileName: string;
} | null {
  const segments = path.split("/");
  if (segments.length !== 3) return null;
  const [workspaceId, productId, fileName] = segments;
  if (!isUuid(workspaceId) || !isUuid(productId)) return null;
  if (!fileName || fileName.includes("..")) return null;
  return { workspaceId, productId, fileName };
}

/**
 * The hostname Next.js must be told to allow in `images.remotePatterns`.
 * Returns null when the URL is missing or unparseable so the build still works
 * before a Supabase project is connected.
 */
export function storageHostname(
  supabaseUrl: string | undefined,
): string | null {
  if (!supabaseUrl) return null;
  try {
    return new URL(supabaseUrl).hostname;
  } catch {
    return null;
  }
}

/** Public object URL for a bucket marked `public` in the storage migration. */
export function publicStorageUrl(
  supabaseUrl: string,
  bucket: string,
  path: string,
): string {
  const base = supabaseUrl.replace(/\/$/, "");
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${bucket}/${encoded}`;
}

/**
 * Public URL for a product image. Safe in both Server and Client Components -
 * `NEXT_PUBLIC_SUPABASE_URL` is inlined at build time.
 */
export function productImageUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return "";
  return publicStorageUrl(base, PRODUCT_IMAGE_BUCKET, storagePath);
}
