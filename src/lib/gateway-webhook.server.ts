import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit.server";
import { maybeAutoReply } from "@/lib/ai-auto-reply.server";
import { decryptSecret } from "@/lib/crypto.server";
import { toE164 } from "@/lib/gateway.server";

// Nexus WhatsApp Gateway receiving endpoint (multi-tenant).
// Each connected workspace gets its own URL:
//   https://<app>/api/public/gateway/webhook/<webhook_token>
// The token identifies the tenant; the HMAC signature (that tenant's own
// signing secret) authenticates the request. The legacy tokenless URL is still
// accepted and resolves the tenant by trying each stored secret.

function verify(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const candidates = [
    "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex"),
    createHmac("sha256", secret).update(rawBody).digest("hex"),
  ];
  const a = Buffer.from(header);
  for (const expected of candidates) {
    const b = Buffer.from(expected);
    if (a.length !== b.length) continue;
    try {
      if (timingSafeEqual(a, b)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

async function secretOf(row: { webhook_secret: string | null }) {
  if (!row.webhook_secret) return null;
  return (await decryptSecret(row.webhook_secret)) ?? row.webhook_secret;
}

/** Resolve the tenant this event belongs to, verifying its own signing secret. */
async function resolveBusiness(rawBody: string, signature: string | null, token: string | null) {
  if (token) {
    const { data: row } = await (supabaseAdmin.from("gateway_settings") as any)
      .select("business_id,webhook_secret")
      .eq("webhook_token", token)
      .eq("is_active", true)
      .maybeSingle();
    if (!row) return null;
    const secret = await secretOf(row);
    if (!secret) return null;
    return verify(rawBody, signature, secret) ? (row.business_id as string) : null;
  }

  const { data } = await supabaseAdmin
    .from("gateway_settings")
    .select("business_id,webhook_secret")
    .eq("is_active", true);
  for (const row of data ?? []) {
    const secret = await secretOf(row);
    if (secret && verify(rawBody, signature, secret)) return row.business_id as string;
  }
  return null;
}

async function logEvent(businessId: string | null, payload: Record<string, unknown>, error?: string | null) {
  const { error: logErr } = await supabaseAdmin.from("webhook_logs").insert({
    business_id: businessId,
    source: "nexus_gateway",
    payload: payload as never,
    signature_ok: !error,
    processed_at: new Date().toISOString(),
    error: error ? error.slice(0, 1000) : null,
  });
  if (logErr) console.error("Gateway webhook log insert failed:", logErr);
}

function digits(v: unknown) {
  return String(v ?? "").replace(/\D/g, "");
}

async function findContact(businessId: string, phone: string) {
  const variants = Array.from(new Set([phone, phone.replace(/^\+/, "")]));
  const { data: exact } = await supabaseAdmin
    .from("contacts")
    .select("id,phone")
    .eq("business_id", businessId)
    .in("phone", variants)
    .limit(1)
    .maybeSingle();
  if (exact) return exact;
  const { data: all } = await supabaseAdmin
    .from("contacts")
    .select("id,phone")
    .eq("business_id", businessId)
    .limit(1000);
  return (all ?? []).find((c) => digits(c.phone) === digits(phone)) ?? null;
}

async function getOrCreateConversation(businessId: string, contactId: string) {
  const { data: existing } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("contact_id", contactId)
    .maybeSingle();
  if (existing) return existing;
  const { data: created, error } = await supabaseAdmin
    .from("conversations")
    .insert({ business_id: businessId, contact_id: contactId })
    .select("id")
    .single();
  if (!error) return created;
  const { data: raced } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("contact_id", contactId)
    .single();
  return raced;
}

export async function handleGatewayWebhook(request: Request, token: string | null): Promise<Response> {
  const allowed = await checkRateLimit("gateway_webhook", clientIp(request), 240, 60);
  if (!allowed) return tooManyRequests();

  // Raw body first — required for signature verification.
  const rawBody = await request.text();
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  // The registration ping is intentionally unsigned.
  if (payload?.event === "webhook.test") {
    await logEvent(null, { event: "webhook.test", token });
    return new Response("ok", { status: 200 });
  }

  const signature =
    request.headers.get("X-Gateway-Signature") ??
    request.headers.get("x-webhook-signature") ??
    request.headers.get("x-signature");
  const businessId = await resolveBusiness(rawBody, signature, token);
  if (!businessId) {
    await logEvent(null, { event: payload?.event ?? "unknown", token }, "Invalid gateway webhook signature");
    return new Response("Invalid signature", { status: 401 });
  }

  try {
    if (payload.event === "message.status") {
      const messageId: string | null = payload.messageId ?? null;
      const providerId: string | null = payload.providerMessageId ?? null;
      let target: { id: string } | null = null;
      if (messageId) {
        const { data } = await supabaseAdmin
          .from("messages")
          .select("id")
          .eq("provider_message_id", messageId)
          .maybeSingle();
        target = data ?? null;
      }
      if (!target && providerId) {
        const { data } = await supabaseAdmin
          .from("messages")
          .select("id")
          .eq("provider_message_id", providerId)
          .maybeSingle();
        target = data ?? null;
      }
      if (target) {
        await supabaseAdmin.from("message_delivery_logs").insert({
          message_id: target.id,
          status: String(payload.status ?? "unknown"),
          provider_status: String(payload.status ?? ""),
        });
      }
      await logEvent(businessId, payload);
      return new Response("ok", { status: 200 });
    }

    if (payload.event === "message.inbound") {
      const phone = toE164(payload.from ?? "");
      const body = String(payload.body ?? "");
      const providerId: string | null = payload.providerMessageId ?? null;
      const channel = payload.channel === "sms" ? "sms" : "whatsapp";

      const contact = await findContact(businessId, phone);
      if (!contact) {
        await supabaseAdmin.from("gateway_unmatched_messages").insert({
          business_id: businessId,
          phone,
          channel,
          body,
          provider_message_id: providerId,
          payload: payload as never,
        });
        await logEvent(businessId, { ...payload, unmatched: true });
        return new Response("ok", { status: 200 });
      }

      const conversation = await getOrCreateConversation(businessId, contact.id);

      if (providerId) {
        const { data: dupe } = await supabaseAdmin
          .from("messages")
          .select("id")
          .eq("contact_id", contact.id)
          .eq("provider_message_id", providerId)
          .maybeSingle();
        if (dupe) {
          await logEvent(businessId, { ...payload, duplicate: true });
          return new Response("ok", { status: 200 });
        }
      }

      const { error: insErr } = await supabaseAdmin.from("messages").insert({
        contact_id: contact.id,
        conversation_id: conversation?.id ?? null,
        direction: "inbound",
        content: body,
        channel,
        provider_message_id: providerId,
        created_at: payload.receivedAt ?? new Date().toISOString(),
      });
      if (insErr) throw insErr;
      await logEvent(businessId, payload);

      if (conversation?.id) {
        try {
          await maybeAutoReply({
            businessId,
            contactId: contact.id,
            conversationId: conversation.id,
            toPhone: phone,
          });
        } catch (aiErr) {
          console.error("[Gateway webhook] AI reply failed", aiErr);
        }
      }
      return new Response("ok", { status: 200 });
    }

    await logEvent(businessId, payload);
  } catch (err) {
    console.error("Gateway webhook error:", err);
    await logEvent(businessId, payload, err instanceof Error ? err.message : String(err));
  }

  return new Response("ok", { status: 200 });
}
