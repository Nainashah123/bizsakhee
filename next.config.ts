import type { NextConfig } from "next";

/**
 * Remote image hosts.
 *
 * Product images live in the public `product-images` Supabase Storage bucket,
 * so `next/image` has to be told the project host is allowed. The host is
 * derived from NEXT_PUBLIC_SUPABASE_URL rather than hard-coded, and an absent
 * or unparseable value yields an empty list so the build still succeeds before
 * a Supabase project is connected.
 */
function supabaseRemotePatterns(): NonNullable<
  NonNullable<NextConfig["images"]>["remotePatterns"]
> {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return [];

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return [];

    return [
      {
        protocol: url.protocol === "https:" ? "https" : "http",
        hostname: url.hostname,
        ...(url.port ? { port: url.port } : {}),
        // Scoped to public objects: signed and private paths are never images.
        pathname: "/storage/v1/object/public/**",
      },
    ];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  // Some CI runners and Playwright default to the loopback IP rather than
  // "localhost". Without this, `next dev` treats its own asset requests as
  // cross-origin and blocks them, so pages render but never hydrate.
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    remotePatterns: supabaseRemotePatterns(),
  },
};

export default nextConfig;
