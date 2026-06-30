import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit.server";

// Protected by CRON_SECRET — callers must provide it via `x-cron-secret`
// header or `?token=`. Fail-closed: if the secret is not configured the
// endpoint refuses all calls.
function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false; // fail-closed when not configured
  const header = request.headers.get("x-cron-secret");
  if (header && header === expected) return true;
  try {
    const url = new URL(request.url);
    return url.searchParams.get("token") === expected;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/run-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthorized(request)) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Tight limit — this is an internal cron, not a public endpoint.
        const ip = clientIp(request);
        const allowed = await checkRateLimit("run_reminders", ip, 10, 60);
        if (!allowed) return tooManyRequests();

        try {
          const now = new Date().toISOString();
          const { data: due, error } = await supabaseAdmin
            .from("reminders")
            .select("id,business_id,contact_id,note")
            .eq("status", "pending")
            .lte("due_at", now)
            .limit(200);

          if (error) throw error;

          let processed = 0;
          for (const r of due ?? []) {
            try {
              await supabaseAdmin.from("automation_runs").insert({
                business_id: r.business_id,
                rule_id: r.id,
                contact_id: r.contact_id,
                status: "success",
                detail: `Reminder due: ${(r.note ?? "").slice(0, 500)}`,
              });
              await supabaseAdmin
                .from("reminders")
                .update({ status: "done" })
                .eq("id", r.id);
              processed++;
            } catch (e) {
              console.error("reminder row failed", r.id, e);
            }
          }
          return Response.json({ processed });
        } catch (e) {
          console.error("run-reminders failed", e);
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
