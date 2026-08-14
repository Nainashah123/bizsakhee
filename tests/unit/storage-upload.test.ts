import { describe, expect, it } from "vitest";

import { parseProductImagePath } from "@/lib/storage/paths";
import {
  MAX_PRODUCT_IMAGE_BYTES,
  assertImageBytes,
  extensionOf,
  isSafeUploadFileName,
  readImageDimensions,
  sniffImageMime,
  validateProductImageUpload,
} from "@/lib/storage/upload";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE = "22222222-2222-4222-8222-222222222222";
const PRODUCT = "33333333-3333-4333-8333-333333333333";
const OBJECT_ID = "44444444-4444-4444-8444-444444444444";

function upload(
  file: { name: string; size: number; type: string },
  overrides: Partial<Parameters<typeof validateProductImageUpload>[0]> = {},
) {
  return validateProductImageUpload(
    {
      file,
      workspaceId: WORKSPACE,
      productId: PRODUCT,
      allowedWorkspaceIds: [WORKSPACE],
      ...overrides,
    },
    { objectId: OBJECT_ID },
  );
}

const JPEG = { name: "diya.jpg", size: 120_000, type: "image/jpeg" };

describe("validateProductImageUpload - accepted files", () => {
  it("builds a path whose first segment is the workspace the policy checks", () => {
    const result = upload(JPEG);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.path).toBe(`${WORKSPACE}/${PRODUCT}/${OBJECT_ID}.jpg`);
    expect(result.data.path.split("/")[0]).toBe(WORKSPACE);
    expect(result.data.mimeType).toBe("image/jpeg");
    expect(result.data.byteSize).toBe(120_000);

    // The stored path must round-trip through the parser used elsewhere.
    expect(parseProductImagePath(result.data.path)).toEqual({
      workspaceId: WORKSPACE,
      productId: PRODUCT,
      fileName: `${OBJECT_ID}.jpg`,
    });
  });

  it("normalises the extension and discards the original filename", () => {
    const result = upload({
      name: "MY PHOTO.JPEG",
      size: 4_000,
      type: "image/jpeg",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.extension).toBe("jpg");
    expect(result.data.path.toLowerCase()).not.toContain("my photo");
  });

  it("accepts every supported format", () => {
    const cases = [
      { name: "a.png", type: "image/png", extension: "png" },
      { name: "a.webp", type: "image/webp", extension: "webp" },
      { name: "a.avif", type: "image/avif", extension: "avif" },
    ];

    for (const item of cases) {
      const result = upload({ name: item.name, size: 1_000, type: item.type });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.extension).toBe(item.extension);
    }
  });

  it("tolerates a charset parameter on the reported type", () => {
    const result = upload({
      name: "a.png",
      size: 1_000,
      type: "image/png; charset=binary",
    });
    expect(result.ok).toBe(true);
  });

  it("generates a distinct object name for each upload", () => {
    const first = validateProductImageUpload({
      file: JPEG,
      workspaceId: WORKSPACE,
      productId: PRODUCT,
      allowedWorkspaceIds: [WORKSPACE],
    });
    const second = validateProductImageUpload({
      file: JPEG,
      workspaceId: WORKSPACE,
      productId: PRODUCT,
      allowedWorkspaceIds: [WORKSPACE],
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.data.path).not.toBe(second.data.path);
  });
});

describe("validateProductImageUpload - tenancy", () => {
  it("refuses a workspace the caller does not belong to", () => {
    const result = upload(JPEG, {
      workspaceId: OTHER_WORKSPACE,
      allowedWorkspaceIds: [WORKSPACE],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
    expect(result.error.message).not.toContain(OTHER_WORKSPACE);
  });

  it("refuses a workspace id that is not a uuid at all", () => {
    const result = upload(JPEG, {
      workspaceId: "../../etc",
      allowedWorkspaceIds: ["../../etc"],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("forbidden");
  });

  it("refuses a product id that is not a uuid", () => {
    const result = upload(JPEG, { productId: "not-a-uuid" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });

  it("checks tenancy before anything else", () => {
    // An oversized file for the wrong workspace still reports "forbidden", so
    // the response cannot be used to probe other workspaces.
    const result = upload(
      {
        name: "huge.jpg",
        size: MAX_PRODUCT_IMAGE_BYTES + 1,
        type: "image/jpeg",
      },
      { workspaceId: OTHER_WORKSPACE },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("forbidden");
  });
});

describe("validateProductImageUpload - file rules", () => {
  it("rejects a MIME type that is not an accepted image", () => {
    for (const type of ["image/gif", "application/pdf", "text/html", ""]) {
      const result = upload({ name: "a.jpg", size: 1_000, type });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation");
    }
  });

  it("rejects an executable extension even when the type claims an image", () => {
    for (const name of [
      "payload.php",
      "payload.svg",
      "payload.html",
      "payload",
    ]) {
      const result = upload({ name, size: 1_000, type: "image/png" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("extension");
      }
    }
  });

  it("rejects an extension that disagrees with the declared type", () => {
    const result = upload({
      name: "photo.png",
      size: 1_000,
      type: "image/jpeg",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe(
        "The file extension does not match the image type.",
      );
    }
  });

  it("rejects a double extension whose final segment is not an image", () => {
    const result = upload({
      name: "photo.png.exe",
      size: 1_000,
      type: "image/png",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a file larger than 5MB", () => {
    const result = upload({
      name: "big.jpg",
      size: MAX_PRODUCT_IMAGE_BYTES + 1,
      type: "image/jpeg",
    });

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.message).toBe("Images must be 5MB or smaller.");
  });

  it("accepts a file of exactly 5MB", () => {
    const result = upload({
      name: "edge.jpg",
      size: MAX_PRODUCT_IMAGE_BYTES,
      type: "image/jpeg",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an empty file", () => {
    const result = upload({ name: "empty.jpg", size: 0, type: "image/jpeg" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("That file is empty.");
  });
});

describe("filename safety", () => {
  const traversal = [
    "../../etc/passwd.jpg",
    "..\\..\\windows\\system32.jpg",
    "/absolute/path.jpg",
    "sub/dir/photo.jpg",
    "%2e%2e%2fescape.jpg",
    "photo%2fescape.jpg",
    ".hidden.jpg",
    "..",
    ".",
    "photo\u0000.jpg",
    "photo\nname.jpg",
  ];

  it.each(traversal)("rejects %j as a filename", (name) => {
    expect(isSafeUploadFileName(name)).toBe(false);

    const result = upload({ name, size: 1_000, type: "image/jpeg" });
    expect(result.ok).toBe(false);
  });

  it("accepts an ordinary filename with spaces and dots", () => {
    expect(isSafeUploadFileName("Diwali hamper v2.final.jpg")).toBe(true);
  });

  it("reads the extension from the last dot only", () => {
    expect(extensionOf("a.b.c.png")).toBe("png");
    expect(extensionOf("noextension")).toBeNull();
    expect(extensionOf("trailing.")).toBeNull();
    expect(extensionOf(".hidden")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Content checks
// ---------------------------------------------------------------------------

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set(PNG_HEADER, 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR chunk length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpegBytes(width: number, height: number): Uint8Array {
  // SOI, then a minimal SOF0 frame header.
  const bytes = new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x00, 0x00, 0x00, 0x03,
  ]);
  const view = new DataView(bytes.buffer);
  view.setUint16(7, height);
  view.setUint16(9, width);
  return bytes;
}

describe("sniffImageMime", () => {
  it("identifies a PNG from its signature", () => {
    expect(sniffImageMime(pngBytes(10, 10))).toBe("image/png");
  });

  it("identifies a JPEG from its signature", () => {
    expect(sniffImageMime(jpegBytes(10, 10))).toBe("image/jpeg");
  });

  it("identifies a WebP RIFF container", () => {
    const bytes = new Uint8Array(16);
    bytes.set([...Buffer.from("RIFF")], 0);
    bytes.set([...Buffer.from("WEBP")], 8);
    expect(sniffImageMime(bytes)).toBe("image/webp");
  });

  it("returns null for content that is not an image", () => {
    expect(
      sniffImageMime(new Uint8Array([...Buffer.from("<?php echo 1;")])),
    ).toBeNull();
    expect(sniffImageMime(new Uint8Array())).toBeNull();
  });
});

describe("assertImageBytes", () => {
  it("accepts a body whose header matches the declared type", () => {
    expect(assertImageBytes(pngBytes(4, 4), "image/png").ok).toBe(true);
  });

  it("rejects a PNG body declared as a JPEG", () => {
    const result = assertImageBytes(pngBytes(4, 4), "image/jpeg");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation");
      expect(result.error.message).toContain("do not match");
    }
  });

  it("rejects a script disguised with an image extension", () => {
    const script = new Uint8Array([...Buffer.from("<?php system($_GET[0]);")]);
    const result = assertImageBytes(script, "image/png");

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.message).toContain("not a readable image");
  });
});

describe("readImageDimensions", () => {
  it("reads PNG width and height from the IHDR chunk", () => {
    expect(readImageDimensions(pngBytes(1200, 800))).toEqual({
      width: 1200,
      height: 800,
    });
  });

  it("reads JPEG width and height from the frame header", () => {
    expect(readImageDimensions(jpegBytes(640, 480))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("returns null rather than guessing for unknown content", () => {
    expect(readImageDimensions(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});
