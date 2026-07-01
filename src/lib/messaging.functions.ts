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

export type OutboundMedia = {
  url: string; // publicly reachable (signed) URL Meta can fetch
  type: "image" | "video" | "audio" | "document";
  mime?: string;
  filename?: string;
};

export async function sendWhatsApp(
  businessId: string,
  toPhone: string,
  content: string,
  media?: OutboundMedia,
) {
  const { token, phoneNumberId } = await resolveWhatsAppSendConfig(businessId);
  const to = toPhone.replace(/^\+/, "");
  let body: Record<string, unknown>;
  if (media) {
    const mediaObj: Record<string, string> = { link: media.url };
    if (content) mediaObj.caption = content;
    if (media.type === "document" && media.filename) mediaObj.filename = media.filename;
    body = {
      messaging_product: "whatsapp",
      to,
      type: media.type,
      [media.type]: mediaObj,
    };
  } else {
    body = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: content },
    };
  }
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
        content: z.string().trim().max(4000).default(""),
        media: z
          .object({
            path: z.string().min(1).max(500),
            type: z.enum(["image", "video", "audio", "document"]),
            mime: z.string().max(120).optional(),
            filename: z.string().max(200).optional(),
            size: z.number().int().nonnegative().optional(),
          })
          .optional(),
      })
      .refine((v) => (v.content && v.content.length > 0) || v.media, {
        message: "content or media required",
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: contact, error: contactErr } = await supabase
      .from("contacts")
      .select("id,phone,business_id")
      .eq("id", data.contactId)
      .single();
    if (contactErr || !contact) throw new Error("Contact not found");

    let mediaForSend: OutboundMedia | undefined;
    let mediaPublicUrl: string | null = null;
    if (data.media) {
      // Sign a URL Meta can fetch. Also cache it on the message row so the UI
      // can display it without a per-render server round trip (bucket is
      // private; the signed URL is scoped and time-limited).
      const { data: signed, error: signedErr } = await supabase.storage
        .from("chat-media")
        .createSignedUrl(data.media.path, 60 * 60 * 24 * 7);
      if (signedErr || !signed) throw new Error(signedErr?.message ?? "Signed URL failed");
      mediaPublicUrl = signed.signedUrl;
      mediaForSend = {
        url: signed.signedUrl,
        type: data.media.type,
        mime: data.media.mime,
        filename: data.media.filename,
      };
    }

    let channel: "whatsapp" | "sms" = "whatsapp";
    let lastError: string | null = null;

    try {
      await sendWhatsApp(contact.business_id, contact.phone, data.content, mediaForSend);
    } catch (err) {
      lastError = err instanceof Error ? err.message : "WhatsApp failed";
      if (mediaForSend) {
        // Media over SMS is not supported by AT; surface the WhatsApp error.
        throw new Error(`WhatsApp send failed: ${lastError}`);
      }
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
        ...(data.media
          ? {
              media_url: mediaPublicUrl,
              media_type: data.media.type,
              media_mime: data.media.mime ?? null,
              media_filename: data.media.filename ?? null,
              media_size: data.media.size ?? null,
            }
          : {}),
      })
      .select()
      .single();
    if (insErr) throw new Error(insErr.message);
    return { message: inserted, channel };
  });
