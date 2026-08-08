import { createFileRoute } from "@tanstack/react-router";
import { processRoutingQueue } from "@/lib/routing.server";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit.server";

// Protected by CRON_SECRET — callers must provide it via `x-cron-secret`
// header or `?token=`. Fail-closed when the secret is not configured.
function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get("x-cron-secret");
  if (header && header === expected) return true;
  try {
    const url = new URL(request.url);
    return url.searchParams.get("token") === expected;
  } catch {
    return false;
  }
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
