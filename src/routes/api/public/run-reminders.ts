import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Called hourly by pg_cron. Marks due reminders and inserts a notification message.
export const Route = createFileRoute("/api/public/run-reminders")({
  server: {
    handlers: {
      POST: async () => {
        const now = new Date().toISOString();
        const { data: due } = await supabaseAdmin
          .from("reminders")
          .select("id,business_id,contact_id,note")
          .eq("status", "pending")
          .lte("due_at", now)
          .limit(200);

        for (const r of due ?? []) {
          await supabaseAdmin.from("automation_runs").insert({
            business_id: r.business_id,
            rule_id: r.id,
            contact_id: r.contact_id,
            status: "success",
            detail: `Reminder due: ${r.note ?? ""}`,
          });
          await supabaseAdmin.from("reminders").update({ status: "done" }).eq("id", r.id);
        }
        return Response.json({ processed: due?.length ?? 0 });
      },
      GET: async () => Response.json({ ok: true }),
    },
  },
});
