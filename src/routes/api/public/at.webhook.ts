import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Africa's Talking inbound SMS webhook.
// Configure URL: https://<your-domain>/api/public/at.webhook
// AT posts application/x-www-form-urlencoded with fields: from, to, text, date, id, linkId
export const Route = createFileRoute("/api/public/at/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const form = await request.formData();
          const from = String(form.get("from") ?? "").trim();
          const to = String(form.get("to") ?? "").trim();
          const text = String(form.get("text") ?? "").trim();
          if (!from || !text) return new Response("ok");

          // Find a business that has an active AT credential matching the destination shortcode/sender
          const { data: creds } = await supabaseAdmin
            .from("channel_credentials")
            .select("business_id,credentials")
            .eq("provider", "africastalking")
            .eq("is_active", true);
          const match = (creds ?? []).find((c) => {
            const sender = (c.credentials as Record<string, string>)?.sender_id;
            return !sender || sender === to;
          }) ?? creds?.[0];
          if (!match) return new Response("ok");
          const businessId = match.business_id;

          // Find or create contact
          let contactId: string;
          const { data: existing } = await supabaseAdmin
            .from("contacts").select("id").eq("business_id", businessId).eq("phone", from).maybeSingle();
          if (existing) contactId = existing.id;
          else {
            const { data: created, error } = await supabaseAdmin
              .from("contacts").insert({ business_id: businessId, name: from, phone: from }).select("id").single();
            if (error) return new Response("ok");
            contactId = created.id;
          }

          await supabaseAdmin.from("messages").insert({
            contact_id: contactId, direction: "inbound", content: text, channel: "sms",
          });
          return new Response("ok");
        } catch {
          return new Response("ok");
        }
      },
    },
  },
});
