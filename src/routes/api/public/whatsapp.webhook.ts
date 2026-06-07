import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit.server";

// Meta WhatsApp Cloud API webhook.
// Public URL example: https://<project>.lovable.app/api/public/whatsapp/webhook
// Configure this URL in Meta App Dashboard -> WhatsApp -> Configuration.

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return false;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice("sha256=".length);
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(provided, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function findBusinessForPhoneNumberId(phoneNumberId: string | undefined) {
  // Multi-tenant routing: map the receiving business phone-number-id to a business.
  // For the MVP we route everything to a single business: the env-configured one,
  // or the first business if not set.
  const configured = process.env.WHATSAPP_DEFAULT_BUSINESS_ID;
  if (configured) return configured;
  const { data } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function upsertContact(businessId: string, phone: string, name: string | null) {
  const { data: existing } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .eq("business_id", businessId)
    .eq("phone", phone)
    .maybeSingle();
  if (existing) return existing.id;
  const { data: created, error } = await supabaseAdmin
    .from("contacts")
    .insert({ business_id: businessId, phone, name: name ?? phone })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      // Meta verification handshake
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
        if (mode === "subscribe" && verifyToken && token === verifyToken) {
          return new Response(challenge ?? "", { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
      },

      POST: async ({ request }) => {
        const ip = clientIp(request);
        const allowed = await checkRateLimit("whatsapp_webhook", ip, 240, 60);
        if (!allowed) return tooManyRequests();

        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (contentLength > 65_536) {
          return new Response("Payload too large", { status: 413 });
        }

        const rawBody = await request.text();
        const sig = request.headers.get("x-hub-signature-256");
        if (!verifySignature(rawBody, sig)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: any;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        try {
          const entries = payload?.entry ?? [];
          for (const entry of entries) {
            for (const change of entry?.changes ?? []) {
              const value = change?.value ?? {};
              const phoneNumberId: string | undefined = value?.metadata?.phone_number_id;
              const businessId = await findBusinessForPhoneNumberId(phoneNumberId);
              if (!businessId) continue;

              const contactsMeta: Array<{ wa_id: string; profile?: { name?: string } }> =
                value?.contacts ?? [];
              const nameByWaId = new Map<string, string>();
              for (const c of contactsMeta) {
                if (c?.wa_id && c?.profile?.name) nameByWaId.set(c.wa_id, c.profile.name);
              }

              const messages: any[] = value?.messages ?? [];
              for (const m of messages) {
                const from: string = m?.from;
                if (!from) continue;
                const phone = `+${from}`;
                const text: string =
                  m?.text?.body ?? m?.button?.text ?? `[${m?.type ?? "message"}]`;

                const contactId = await upsertContact(
                  businessId,
                  phone,
                  nameByWaId.get(from) ?? null,
                );

                await supabaseAdmin.from("messages").insert({
                  contact_id: contactId,
                  direction: "inbound",
                  content: text,
                  channel: "whatsapp",
                });
              }
            }
          }
        } catch (err) {
          console.error("WhatsApp webhook error:", err);
          // Always 200 so Meta doesn't retry forever on our internal errors
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
