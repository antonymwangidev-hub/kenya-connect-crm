import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Guided WhatsApp connection server fns.
// These create/update rows in whatsapp_connections so the UI can drive a
// realistic flow today. The actual Meta Embedded Signup popup needs an
// app id + config token, which we read from channel_credentials.whatsapp.meta
// once the user pastes them in Settings → Advanced.

export const getMyWhatsappConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data } = await supabase
      .from("whatsapp_connections")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { connection: data ?? null };
  });

export const getEmbeddedSignupConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data } = await supabase
      .from("channel_credentials")
      .select("credentials")
      .eq("provider", "whatsapp")
      .maybeSingle();
    const creds = (data?.credentials as Record<string, string> | null) ?? {};
    return {
      ready: Boolean(creds.app_id && creds.config_id),
      appId: creds.app_id ?? null,
      configId: creds.config_id ?? null,
    };
  });

export const startWhatsappConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        phoneNumber: z.string().trim().min(7).max(20),
        displayName: z.string().trim().min(2).max(60),
        path: z.enum(["existing", "new_number"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: biz } = await supabase.from("businesses").select("id").limit(1).single();
    const { data: row, error } = await supabase
      .from("whatsapp_connections")
      .insert({
        business_id: biz.id,
        phone_number: data.phoneNumber,
        display_name: data.displayName,
        status: "connecting",
        meta: { path: data.path },
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { connection: row };
  });

export const completeWhatsappConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        connectionId: z.string().uuid(),
        phoneNumberId: z.string().min(1).optional(),
        wabaId: z.string().min(1).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("whatsapp_connections")
      .update({
        status: "connected",
        phone_number_id: data.phoneNumberId ?? null,
        waba_id: data.wabaId ?? null,
        quality_rating: "GREEN",
        connected_at: new Date().toISOString(),
      })
      .eq("id", data.connectionId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { connection: row };
  });

export const disconnectWhatsapp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ connectionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("whatsapp_connections")
      .update({ status: "disconnected", disconnected_at: new Date().toISOString() })
      .eq("id", data.connectionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
