import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit.server";

// Africa's Talking inbound SMS webhook.
// AT posts application/x-www-form-urlencoded: from, to, text, date, id, linkId

const Phone = z.string().trim().min(3).max(20).regex(/^\+?[0-9]+$/, "invalid phone");
const InboundSchema = z.object({
  from: Phone,
  to: z.string().trim().min(1).max(20).optional().default(""),
  text: z.string().trim().min(1).max(1600),
});

export const Route = createFileRoute("/api/public/at/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = clientIp(request);
        const allowed = await checkRateLimit("at_webhook", ip, 120, 60);
        if (!allowed) return tooManyRequests();

        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (contentLength > 8192) return new Response("ok");

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return new Response("ok");
        }

        const parsed = InboundSchema.safeParse({
          from: String(form.get("from") ?? ""),
          to: String(form.get("to") ?? ""),
          text: String(form.get("text") ?? ""),
        });

        if (!parsed.success) {
          try {
            await supabaseAdmin.from("webhook_logs").insert({
              source: "africastalking",
              payload: { invalid: true, issues: parsed.error.issues.slice(0, 3) } as never,
              signature_ok: false,
              error: parsed.error.issues[0]?.message?.slice(0, 200) ?? "schema_error",
              processed_at: new Date().toISOString(),
            });
          } catch (e) {
            console.error("at log insert failed", e);
          }
          return new Response("ok");
        }

        const { from, to, text } = parsed.data;

        try {
          const { data: creds } = await supabaseAdmin
            .from("channel_credentials")
            .select("business_id,credentials")
            .eq("provider", "africastalking")
            .eq("is_active", true);

          const match =
            (creds ?? []).find((c) => {
              const sender = (c.credentials as Record<string, string>)?.sender_id;
              return !sender || sender === to;
            }) ?? creds?.[0];

          if (!match) return new Response("ok");
          const businessId = match.business_id;

          let contactId: string;
          const { data: existing } = await supabaseAdmin
            .from("contacts")
            .select("id")
            .eq("business_id", businessId)
            .eq("phone", from)
            .maybeSingle();
          if (existing) {
            contactId = existing.id;
          } else {
            const { data: created, error } = await supabaseAdmin
              .from("contacts")
              .insert({ business_id: businessId, name: from, phone: from })
              .select("id")
              .single();
            if (error) return new Response("ok");
            contactId = created.id;
          }

          await supabaseAdmin.from("messages").insert({
            contact_id: contactId,
            direction: "inbound",
            content: text,
            channel: "sms",
          });

          await supabaseAdmin.from("webhook_logs").insert({
            source: "africastalking",
            payload: { from, to, text } as never,
            signature_ok: true,
            processed_at: new Date().toISOString(),
          });
        } catch (e) {
          console.error("at webhook error", e);
        }

        return new Response("ok");
      },
    },
  },
});
