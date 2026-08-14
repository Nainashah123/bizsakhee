import { z } from "zod";

import { err, ok, type Result } from "@/lib/result";
import {
  isUuid,
  productImageObjectPath,
  randomObjectId,
} from "@/lib/storage/paths";

/**
 * Upload validation.
 *
 * Everything here runs on the server before a byte reaches Supabase Storage.
 * The browser-reported `type` is treated as a hint, never as proof:
 *
 *   1. the declared MIME type must be one we accept,
 *   2. the file extension must be one we accept AND must agree with the
 *      declared type (a `.php` claiming `image/png` is rejected),
 *   3. the magic bytes must agree with the declared type when the body is
 *      available (`assertImageBytes`),
 *   4. the filename must not be able to escape its folder,
 *   5. the workspace must be one the caller actually belongs to.
 *
 * The generated object name is a fresh UUID, so the user-supplied filename is
 * never used as a path component at all - the extension is the only thing that
 * survives.
 */

export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

export const PRODUCT_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

export type ProductImageMime = (typeof PRODUCT_IMAGE_MIME_TYPES)[number];

/** Every extension we accept, mapped to the single MIME type it may claim. */
const MIME_BY_EXTENSION: Record<string, ProductImageMime> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

/** Canonical extension stored on disk for each accepted MIME type. */
const EXTENSION_BY_MIME: Record<ProductImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export function isProductImageMime(value: string): value is ProductImageMime {
  return (PRODUCT_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export const ACCEPT_ATTRIBUTE = PRODUCT_IMAGE_MIME_TYPES.join(",");

// ---------------------------------------------------------------------------
// Filename safety
// ---------------------------------------------------------------------------

const PATH_SEPARATORS = ["/", "\\"];

/** Percent-encoded "/", "\" and NUL, which some clients send unescaped. */
const ENCODED_SEPARATOR = /%2f|%5c|%00/i;

export function isSafeUploadFileName(name: string): boolean {
  const value = name.trim();
  if (value === "" || value.length > 255) return false;

  // A leading dot is either a relative path (".", "..") or a hidden file.
  if (value.startsWith(".")) return false;
  if (PATH_SEPARATORS.some((separator) => value.includes(separator))) {
    return false;
  }
  if (ENCODED_SEPARATOR.test(value)) return false;

  // Control characters (including NUL) can confuse downstream path handling.
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return false;
  }

  return true;
}

/** Lowercase extension without the dot, or null when there is not one. */
export function extensionOf(name: string): string | null {
  const index = name.lastIndexOf(".");
  if (index <= 0 || index === name.length - 1) return null;
  const extension = name.slice(index + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(extension) ? extension : null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * The metadata a `File` exposes. Kept as a plain object so this module stays
 * pure and testable without constructing real `File` instances.
 */
export const uploadCandidateSchema = z.object({
  name: z.string().min(1, "That file has no name.").max(255),
  size: z.number().int().nonnegative(),
  type: z.string().max(120),
});

export type UploadCandidate = z.infer<typeof uploadCandidateSchema>;

export type ValidatedUpload = {
  /** `<workspace_id>/<product_id>/<uuid>.<ext>` */
  path: string;
  mimeType: ProductImageMime;
  extension: string;
  byteSize: number;
};

export type ValidateUploadInput = {
  file: { name: string; size: number; type: string };
  /** Resolved server-side from the session - never read from the form. */
  workspaceId: string;
  productId: string;
  /** Workspaces the caller is actually a member of. */
  allowedWorkspaceIds: readonly string[];
};

export function validateProductImageUpload(
  input: ValidateUploadInput,
  options: { objectId?: string } = {},
): Result<ValidatedUpload> {
  const { workspaceId, productId, allowedWorkspaceIds } = input;

  // Tenancy first: an unauthorised workspace must not learn anything about
  // which of the other checks it would have failed.
  if (!isUuid(workspaceId) || !allowedWorkspaceIds.includes(workspaceId)) {
    return err("forbidden", "You do not have access to this workspace.");
  }

  if (!isUuid(productId)) {
    return err("not_found", "We could not find that product.");
  }

  const candidate = uploadCandidateSchema.safeParse(input.file);
  if (!candidate.success) {
    return err("validation", "That file could not be read. Try another one.");
  }
  const file = candidate.data;

  if (!isSafeUploadFileName(file.name)) {
    return err(
      "validation",
      "That filename is not allowed. Rename the file and try again.",
    );
  }

  if (file.size === 0) {
    return err("validation", "That file is empty.");
  }

  if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
    return err("validation", "Images must be 5MB or smaller.");
  }

  const declaredType = file.type.split(";")[0].trim().toLowerCase();
  if (!isProductImageMime(declaredType)) {
    return err("validation", "Use a JPEG, PNG, WebP or AVIF image.");
  }

  const extension = extensionOf(file.name);
  if (!extension || !(extension in MIME_BY_EXTENSION)) {
    return err(
      "validation",
      "That file needs a .jpg, .png, .webp or .avif extension.",
    );
  }

  if (MIME_BY_EXTENSION[extension] !== declaredType) {
    return err(
      "validation",
      "The file extension does not match the image type.",
    );
  }

  return ok({
    path: productImageObjectPath({
      workspaceId,
      productId,
      extension: EXTENSION_BY_MIME[declaredType],
      objectId: options.objectId ?? randomObjectId(),
    }),
    mimeType: declaredType,
    extension: EXTENSION_BY_MIME[declaredType],
    byteSize: file.size,
  });
}

// ---------------------------------------------------------------------------
// Content sniffing
// ---------------------------------------------------------------------------

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

/** Identifies the real format from the file header, or null if unrecognised. */
export function sniffImageMime(bytes: Uint8Array): ProductImageMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) {
    return "image/webp";
  }
  // ISO base media file format: [size][ftyp][brand]. AVIF brands vary.
  if (asciiAt(bytes, 4, "ftyp")) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (brand === "avif" || brand === "avis" || brand === "mif1") {
      return "image/avif";
    }
  }
  return null;
}

/** Rejects a body whose magic bytes disagree with the declared MIME type. */
export function assertImageBytes(
  bytes: Uint8Array,
  declared: ProductImageMime,
): Result<ProductImageMime> {
  const sniffed = sniffImageMime(bytes);
  if (!sniffed) {
    return err("validation", "That file is not a readable image.");
  }
  if (sniffed !== declared) {
    return err(
      "validation",
      "That file's contents do not match its image type.",
    );
  }
  return ok(sniffed);
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

export type ImageDimensions = { width: number; height: number };

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
  // 8-byte signature, 4-byte length, "IHDR", then width and height.
  if (bytes.length < 24 || !asciiAt(bytes, 12, "IHDR")) return null;
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    // Standalone markers carry no payload.
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    // SOF0..SOF15, excluding the DHT/JPG/DAC markers at 0xc4, 0xc8, 0xcc.
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isStartOfFrame) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30) return null;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === "VP8X") {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }
  if (chunk === "VP8 ") {
    const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
    const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

/**
 * Best-effort intrinsic size, used to fill `product_images.width/height` so
 * `next/image` can reserve space. Returns null rather than guessing - the
 * columns are nullable precisely because AVIF is not parsed here.
 */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  const mime = sniffImageMime(bytes);
  try {
    if (mime === "image/png") return pngDimensions(bytes);
    if (mime === "image/jpeg") return jpegDimensions(bytes);
    if (mime === "image/webp") return webpDimensions(bytes);
  } catch {
    return null;
  }
  return null;
}
