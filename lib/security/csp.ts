/**
 * Content Security Policy.
 *
 * script-src deliberately uses 'unsafe-inline' rather than a nonce.
 *
 * A nonce has to be minted per request, and most of this app's marketing and
 * auth pages are statically prerendered - their HTML is written at build time,
 * when no request and therefore no nonce exists. A nonce policy was tried and
 * shipped 14 script tags with no nonce attribute; combined with
 * 'strict-dynamic', which makes browsers ignore 'self', every script was
 * blocked and the whole app rendered without hydrating. It looked correct in
 * development, where those pages are rendered per request.
 *
 * So the honest trade-off: script-src is the weakest directive here, and CSP
 * is not this app's primary XSS defence. That job is done by React escaping
 * output, the absence of dangerouslySetInnerHTML, and Zod validation at every
 * boundary. Everything CSP *can* enforce without a nonce is still enforced -
 * no wildcard hosts, no framing, no object embeds, no arbitrary form targets,
 * and a connect-src pinned to this deployment's own Supabase project.
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
  supabaseUrl?: string;
  isDevelopment: boolean;
};

export function buildContentSecurityPolicy({
  supabaseUrl,
  isDevelopment,
}: CspOptions): string {
  const supabase = supabaseOrigins(supabaseUrl);

  const script = [
    "'self'",
    // Required by the RSC bootstrap on prerendered pages. See the note above.
    "'unsafe-inline'",
    "https://js.stripe.com",
    // Turbopack's dev runtime and React Refresh both evaluate generated code.
    // Never sent in production.
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
