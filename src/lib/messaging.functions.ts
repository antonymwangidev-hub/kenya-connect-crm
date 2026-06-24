import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Reads per-business creds from channel_credentials (set in onboarding/Settings).
// Falls back to env vars for backwards compatibility.

async function getCreds(businessId: string, provider: "whatsapp" | "africastalking") {
  const { data } = await supabaseAdmin
    .from("channel_credentials").select("credentials,is_active")
    .eq("business_id", businessId).eq("provider", provider).maybeSingle();
  if (!data?.is_active) return null;
  return data.credentials as Record<string, string>;
}

async function resolveWhatsAppSendConfig(businessId: string) {
  const c = await getCreds(businessId, "whatsapp");
  // Prefer an explicitly connected phone-number row for this business. Do not
  // use another business's env/default phone_number_id; replies route back by
  // phone_number_id, so that creates hidden cross-tenant inbox mismatches.
  const { data: conn } = await supabaseAdmin
    .from("whatsapp_connections")
    .select("phone_number_id,meta,connected_at")
    .eq("business_id", businessId)
    .eq("status", "connected")
    .not("phone_number_id", "is", null)
    .neq("phone_number_id", "")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const connMeta = (conn?.meta ?? {}) as Record<string, string>;
  const token = connMeta.access_token ?? c?.access_token ?? process.env.WHATSAPP_ACCESS_TOKEN;
  let phoneNumberId = conn?.phone_number_id ?? c?.phone_number_id ?? null;

  if (!phoneNumberId) {
    const envPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    const envDefaultBusinessId = process.env.WHATSAPP_DEFAULT_BUSINESS_ID?.trim();
    if (envPhoneNumberId) {
      const { data: envOwner } = await supabaseAdmin
        .from("whatsapp_connections")
        .select("business_id")
        .eq("phone_number_id", envPhoneNumberId)
        .limit(1)
        .maybeSingle();
      const envBelongsHere = envOwner?.business_id === businessId || envDefaultBusinessId === businessId;
      const envBelongsElsewhere = Boolean(
        (envOwner?.business_id && envOwner.business_id !== businessId) ||
          (envDefaultBusinessId && envDefaultBusinessId !== businessId),
      );
      if (envBelongsHere || (!envOwner?.business_id && !envDefaultBusinessId)) {
        phoneNumberId = envPhoneNumberId;
      } else if (envBelongsElsewhere) {
        throw new Error("WhatsApp phone number is configured for a different business; reconnect WhatsApp for this workspace.");
      }
    }
  }

  if (!token || !phoneNumberId) throw new Error("WhatsApp not configured");
  return { token, phoneNumberId };
}

export async function sendWhatsApp(businessId: string, toPhone: string, content: string) {
  const { token, phoneNumberId } = await resolveWhatsAppSendConfig(businessId);
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toPhone.replace(/^\+/, ""),
      type: "text",
      text: { body: content },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function sendAfricasTalking(businessId: string, toPhone: string, content: string) {
  const c = await getCreds(businessId, "africastalking");
  const apiKey = c?.api_key ?? process.env.AFRICASTALKING_API_KEY;
  const username = c?.username ?? process.env.AFRICASTALKING_USERNAME;
  const senderId = c?.sender_id ?? process.env.AFRICASTALKING_SENDER_ID;
  if (!apiKey || !username) throw new Error("Africa's Talking not configured");
  const body = new URLSearchParams({
    username,
    to: toPhone,
    message: content,
    ...(senderId ? { from: senderId } : {}),
  });
  const res = await fetch("https://api.africastalking.com/version1/messaging", {
    method: "POST",
    headers: { apiKey, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Africa's Talking ${res.status}: ${raw.slice(0, 200)}`);
  }
  let data: { SMSMessageData?: { Recipients?: Array<{ messageId?: string; status?: string }> } };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Africa's Talking returned non-JSON: ${raw.slice(0, 200)}`);
  }
  const rec = data.SMSMessageData?.Recipients?.[0];
  if (!rec || (rec.status && !/success|sent/i.test(rec.status))) {
    throw new Error(`Africa's Talking: ${rec?.status ?? "send failed"}`);
  }
  return { sid: rec.messageId };
}


export const sendOutboundMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        contactId: z.string().uuid(),
        content: z.string().trim().min(1).max(4000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Look up contact (RLS scopes to the user's business)
    const { data: contact, error: contactErr } = await supabase
      .from("contacts")
      .select("id,phone,business_id")
      .eq("id", data.contactId)
      .single();
    if (contactErr || !contact) throw new Error("Contact not found");

    let channel: "whatsapp" | "sms" = "whatsapp";
    let lastError: string | null = null;

    // Try WhatsApp first
    try {
      await sendWhatsApp(contact.business_id, contact.phone, data.content);
    } catch (err) {
      lastError = err instanceof Error ? err.message : "WhatsApp failed";
      // Fallback to Africa's Talking SMS
      try {
        const result = await sendAfricasTalking(contact.business_id, contact.phone, data.content);
        channel = "sms";
        await supabase.from("sms_logs").insert({
          business_id: contact.business_id,
          contact_id: contact.id,
          phone: contact.phone,
          message: data.content,
          status: "sent",
          provider_sid: result.sid ?? null,
        });
        lastError = null;
      } catch (smsErr) {
        const msg = smsErr instanceof Error ? smsErr.message : "SMS failed";
        await supabase.from("sms_logs").insert({
          business_id: contact.business_id,
          contact_id: contact.id,
          phone: contact.phone,
          message: data.content,
          status: "failed",
          error: `WhatsApp: ${lastError} | SMS: ${msg}`,
        });
        throw new Error(`Both channels failed. ${msg}`);
      }
    }

    const { data: inserted, error: insErr } = await supabase
      .from("messages")
      .insert({
        contact_id: contact.id,
        direction: "outbound",
        content: data.content,
        channel,
      })
      .select()
      .single();
    if (insErr) throw new Error(insErr.message);
    return { message: inserted, channel };
  });
