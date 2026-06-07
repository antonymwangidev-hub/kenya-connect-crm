import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Database-backed sliding-window rate limiter.
 * - Globally consistent across worker isolates (Cloudflare Workers are stateless).
 * - Fails OPEN on DB errors so a transient outage doesn't drop real webhooks.
 */
export async function checkRateLimit(
  bucket: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.rpc("rate_limit_check", {
      _bucket: bucket,
      _key: key,
      _limit: limit,
      _window_seconds: windowSeconds,
    });
    if (error) {
      console.error("rate_limit_check error", error.message);
      return true; // fail open
    }
    return Boolean(data);
  } catch (e) {
    console.error("rate_limit_check threw", e);
    return true;
  }
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export function tooManyRequests(message = "rate_limited"): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": "60" },
  });
}
