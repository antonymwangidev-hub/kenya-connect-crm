import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendWhatsApp, sendAfricasTalking } from "@/lib/messaging.functions";

export const listWebhookLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("webhook_logs")
      .select("id,source,signature_ok,processed_at,error,payload,created_at,business_id")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listSmsLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("sms_logs")
      .select("id,phone,message,status,error,provider_sid,created_at,contact_id,business_id")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const retrySmsDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ smsLogId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: log, error } = await supabase
      .from("sms_logs")
      .select("id,business_id,contact_id,phone,message,status")
      .eq("id", data.smsLogId)
      .single();
    if (error || !log) throw new Error("Log not found");
    if (log.status !== "failed") throw new Error("Only failed deliveries can be retried");

    let channel: "whatsapp" | "sms" = "whatsapp";
    let lastError: string | null = null;
    let providerSid: string | null = null;
    try {
      await sendWhatsApp(log.business_id, log.phone, log.message);
    } catch (err) {
      lastError = err instanceof Error ? err.message : "WhatsApp failed";
      try {
        const r = await sendAfricasTalking(log.business_id, log.phone, log.message);
        channel = "sms";
        providerSid = r.sid ?? null;
        lastError = null;
      } catch (smsErr) {
        const msg = smsErr instanceof Error ? smsErr.message : "SMS failed";
        await supabase.from("sms_logs").insert({
          business_id: log.business_id,
          contact_id: log.contact_id,
          phone: log.phone,
          message: log.message,
          status: "failed",
          error: `Retry — WhatsApp: ${lastError} | SMS: ${msg}`,
        });
        throw new Error(`Retry failed: ${msg}`);
      }
    }

    await supabase.from("sms_logs").insert({
      business_id: log.business_id,
      contact_id: log.contact_id,
      phone: log.phone,
      message: log.message,
      status: "sent",
      provider_sid: providerSid,
    });
    if (log.contact_id) {
      await supabase.from("messages").insert({
        contact_id: log.contact_id,
        direction: "outbound",
        content: log.message,
        channel,
      });
    }
    return { ok: true, channel };
  });
