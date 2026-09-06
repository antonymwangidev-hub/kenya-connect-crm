import { createFileRoute } from "@tanstack/react-router";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit.server";
import { processAiReplyQueue } from "@/lib/ai-reply-queue.server";

// Safety-net sweeper for the AI auto-reply queue. Any inbound message whose
// reply failed or was interrupted is retried here. Protected by CRON_SECRET —
// fail-closed when the secret is not configured.
function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get("x-cron-secret");
  if (header && header === expected) return true;
  try {
    return new URL(request.url).searchParams.get("token") === expected;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/run-ai-replies")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthorized(request)) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        const allowed = await checkRateLimit("run_ai_replies", clientIp(request), 30, 60);
        if (!allowed) return tooManyRequests();

        const result = await processAiReplyQueue({ limit: 20 });
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
