/**
 * CORS handling, shared by every Edge Function.
 *
 * This block was copy-pasted into nine functions with an identical five-entry
 * origin allowlist. Changing the deployment domain meant editing nine files,
 * and any one of them being missed would break that endpoint in the browser
 * with a CORS error rather than an obvious failure.
 *
 * The allowlist can now also come from ALLOWED_ORIGINS (comma-separated), so a
 * new domain is a configuration change rather than a code change.
 */

const DEFAULT_ORIGINS = [
  "https://o1ne.onrender.com",
  "https://one-iota-three.vercel.app",
  "https://one-phi-blush.vercel.app",
  "http://localhost:5173",
  "http://localhost:4173",
];

function allowedOrigins(): string[] {
  const configured = Deno.env.get("ALLOWED_ORIGINS");
  if (!configured) return DEFAULT_ORIGINS;
  const extra = configured.split(",").map((o) => o.trim()).filter(Boolean);
  return extra.length > 0 ? extra : DEFAULT_ORIGINS;
}

export interface CorsOptions {
  /** Defaults to the read/write verbs a JSON POST API needs. */
  methods?: string;
}

/**
 * Build CORS headers for a request.
 *
 * An unrecognised Origin gets the first allowed origin echoed back, which the
 * browser then refuses — the request fails closed rather than being permitted.
 */
export function getCorsHeaders(req: Request, options: CorsOptions = {}): Record<string, string> {
  const origins = allowedOrigins();
  const origin = req.headers.get("Origin") ?? "";
  const allowed = origins.includes(origin) ? origin : origins[0];

  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": options.methods ?? "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Apikey, X-Client-Info",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

/** Standard preflight response, or null when this is not a preflight. */
export function handlePreflight(req: Request, options?: CorsOptions): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 200, headers: getCorsHeaders(req, options) });
}

/** JSON response carrying the right CORS headers. */
export function jsonResponse(
  req: Request,
  body: unknown,
  status = 200,
  options?: CorsOptions,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req, options), "Content-Type": "application/json" },
  });
}
