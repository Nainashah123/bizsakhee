/**
 * Content Security Policy.
 *
 * Built per request so a fresh nonce can be issued. Next.js reads the nonce
 * back out of this header and stamps it onto the inline bootstrap scripts it
 * emits, which is what lets the policy avoid 'unsafe-inline' for scripts.
 *
 * The Supabase origin is derived from the configured project URL rather than
 * wildcarded, so a compromised page cannot exfiltrate to an arbitrary host.
 */

function supabaseOrigins(supabaseUrl: string | undefined): {
  http: string[];
  websocket: string[];
} {
  if (!supabaseUrl) return { http: [], websocket: [] };

  try {
    const url = new URL(supabaseUrl);
    const secure = url.protocol === "https:";
    return {
      http: [url.origin],
      // Supabase Realtime and the auth token refresh both use a socket.
      websocket: [`${secure ? "wss" : "ws"}://${url.host}`],
    };
  } catch {
    return { http: [], websocket: [] };
  }
}

export type CspOptions = {
  nonce: string;
  supabaseUrl?: string;
  isDevelopment: boolean;
};

export function buildContentSecurityPolicy({
  nonce,
  supabaseUrl,
  isDevelopment,
}: CspOptions): string {
  const supabase = supabaseOrigins(supabaseUrl);

  const script = [
    "'self'",
    `'nonce-${nonce}'`,
    // Lets the nonced bootstrap load the chunks it needs without listing every
    // hashed filename. Older browsers fall back to the 'self' source above.
    "'strict-dynamic'",
    "https://js.stripe.com",
    // Turbopack's dev runtime and React Refresh both evaluate generated code.
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
  ];

  const connect = [
    "'self'",
    ...supabase.http,
    ...supabase.websocket,
    "https://api.stripe.com",
    // Dev server HMR socket.
    ...(isDevelopment ? ["ws://localhost:*", "ws://127.0.0.1:*"] : []),
  ];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": script,
    // Tailwind and Next both inject <style> elements at runtime. There is no
    // nonce path for those, and a stylesheet cannot exfiltrate data the way a
    // script can, so this is the one place inline content is permitted.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...supabase.http],
    "font-src": ["'self'", "data:"],
    "connect-src": connect,
    // Stripe Checkout and the billing portal render inside iframes.
    "frame-src": [
      "https://js.stripe.com",
      "https://hooks.stripe.com",
      "https://checkout.stripe.com",
      "https://billing.stripe.com",
    ],
    // Clickjacking: this app is never framed by anyone.
    "frame-ancestors": ["'none'"],
    "form-action": [
      "'self'",
      "https://checkout.stripe.com",
      "https://billing.stripe.com",
    ],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "worker-src": ["'self'", "blob:"],
  };

  const serialised = Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(" ")}`)
    .join("; ");

  // Only meaningful over TLS, and it would break plain-http local development.
  return isDevelopment
    ? serialised
    : `${serialised}; upgrade-insecure-requests`;
}

/**
 * Headers that do not vary per request.
 *
 * HSTS is deliberately NOT set here: it is applied by the platform on the
 * production domain, and sending it from a local or preview origin can pin a
 * browser to https for a hostname that does not serve it.
 */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<{
  key: string;
  value: string;
}> = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    // Nothing in this product needs these; denying them limits the blast
    // radius of an injected script or a malicious embed.
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];
