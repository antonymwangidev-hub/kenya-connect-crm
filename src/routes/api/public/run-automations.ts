import { createFileRoute } from "@tanstack/react-router";
import { processRoutingQueue } from "@/lib/routing.server";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit.server";

// Callers must present either the CRON_SECRET (`x-cron-secret` header or
// `?token=`) or the project's publishable key in an `apikey` header — the
// documented pattern for scheduled jobs. The endpoint only flushes an
// internal, already-approved action queue.
function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const header = request.headers.get("x-cron-secret");
    if (header && header === expected) return true;
    try {
      const url = new URL(request.url);
      if (url.searchParams.get("token") === expected) return true;
    } catch {
      /* ignore */
    }
  }
  const apiKey = request.headers.get("apikey");
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  return Boolean(apiKey && publishable && apiKey === publishable);
}


export const Route = createFileRoute("/api/public/run-automations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthorized(request)) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        const allowed = await checkRateLimit("run_automations", clientIp(request), 20, 60);
        if (!allowed) return tooManyRequests();

        try {
          const result = await processRoutingQueue({ limit: 100 });
          return Response.json(result);
        } catch (e) {
          console.error("run-automations failed", e);
          return new Response(JSON.stringify({ error: "internal_error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
      GET: async () => Response.json({ ok: true }),
    },
  },
});
