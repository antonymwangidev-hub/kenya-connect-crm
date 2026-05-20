import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Sends a message via WhatsApp if configured, falls back to SMS via Twilio.
// Logs everything to the messages table (and sms_logs for SMS attempts).
async function sendWhatsApp(toPhone: string, content: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error("WhatsApp not configured");
  }
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toPhone.replace(/^\+/, ""),
        type: "text",
        text: { body: content },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp API ${res.status}: ${body}`);
  }
  return res.json();
}

async function sendTwilioSms(toPhone: string, content: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !auth || !from) {
    throw new Error("Twilio not configured");
  }
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${auth}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: toPhone, From: from, Body: content }),
    },
  );
  const data = (await res.json()) as { sid?: string; message?: string };
  if (!res.ok) {
    throw new Error(`Twilio ${res.status}: ${data.message ?? "send failed"}`);
  }
  return data;
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
      await sendWhatsApp(contact.phone, data.content);
    } catch (err) {
      lastError = err instanceof Error ? err.message : "WhatsApp failed";
      // Fallback to SMS
      try {
        const result = await sendTwilioSms(contact.phone, data.content);
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
