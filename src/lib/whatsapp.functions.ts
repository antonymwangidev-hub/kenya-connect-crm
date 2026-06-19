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
    if (!biz) throw new Error("Business not found");
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

// ---------------------------------------------------------------------------
// Meta Embedded Signup: exchange short-lived code for a permanent token,
// persist WABA + phone-number IDs against the user's business, and subscribe
// our webhook to the customer's WABA so their messages route to us.
// ---------------------------------------------------------------------------
export const exchangeWhatsappSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        code: z.string().min(10).max(2048),
        wabaId: z.string().trim().min(1).max(64).optional(),
        phoneNumberId: z.string().trim().min(1).max(64).optional(),
        redirectUri: z.string().url().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const appId = process.env.WHATSAPP_APP_ID;
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    const version = process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0";
    if (!appId || !appSecret) {
      throw new Error("WhatsApp app not configured on the server");
    }

    // 1) Exchange the short-lived code for a long-lived business token.
    const tokenUrl = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("code", data.code);
    if (data.redirectUri) tokenUrl.searchParams.set("redirect_uri", data.redirectUri);
    const tokenRes = await fetch(tokenUrl.toString(), { method: "GET" });
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      error?: { message?: string };
    };
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(tokenJson.error?.message ?? "Failed to exchange code");
    }
    const accessToken = tokenJson.access_token;

    // 2) Discover WABA + phone number if the client didn't pass them.
    let wabaId = data.wabaId ?? null;
    let phoneNumberId = data.phoneNumberId ?? null;
    let phoneNumber: string | null = null;
    let displayName: string | null = null;

    if (!wabaId) {
      const r = await fetch(
        `https://graph.facebook.com/${version}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
      );
      const j = (await r.json()) as { data?: { granular_scopes?: Array<{ scope: string; target_ids?: string[] }> } };
      const waScope = j?.data?.granular_scopes?.find((s) => s.scope === "whatsapp_business_management");
      wabaId = waScope?.target_ids?.[0] ?? null;
    }

    if (wabaId && !phoneNumberId) {
      const r = await fetch(
        `https://graph.facebook.com/${version}/${wabaId}/phone_numbers?access_token=${encodeURIComponent(accessToken)}`,
      );
      const j = (await r.json()) as { data?: Array<{ id: string; display_phone_number: string; verified_name?: string }> };
      const first = j?.data?.[0];
      if (first) {
        phoneNumberId = first.id;
        phoneNumber = first.display_phone_number ?? null;
        displayName = first.verified_name ?? null;
      }
    }

    // 3) Subscribe our app to the customer's WABA so webhooks flow to us.
    if (wabaId) {
      await fetch(`https://graph.facebook.com/${version}/${wabaId}/subscribed_apps`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => null);
    }

    // 4) Register the phone number with Cloud API (idempotent best-effort).
    if (phoneNumberId) {
      await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/register`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messaging_product: "whatsapp", pin: "000000" }),
      }).catch(() => null);
    }

    // 5) Persist against the user's business.
    const { data: biz } = await supabase
      .from("businesses")
      .select("id")
      .eq("owner_id", userId)
      .limit(1)
      .single();
    if (!biz) throw new Error("Business not found");

    const { data: row, error } = await supabase
      .from("whatsapp_connections")
      .insert({
        business_id: biz.id,
        phone_number: phoneNumber ?? "pending",
        display_name: displayName,
        phone_number_id: phoneNumberId,
        waba_id: wabaId,
        status: phoneNumberId ? "connected" : "connecting",
        quality_rating: "GREEN",
        connected_at: new Date().toISOString(),
        meta: {
          source: "embedded_signup",
          access_token: accessToken,
          app_id: appId,
        },
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { connection: row };
  });

