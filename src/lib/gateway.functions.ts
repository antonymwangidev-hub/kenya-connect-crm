import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { encryptSecret } from "@/lib/crypto.server";
import { writeAudit } from "@/lib/audit.server";
import {
  gatewayFetch,
  gatewayUpsertContact,
  isE164,
  loadGatewaySettings,
  normalizeBaseUrl,
  toE164,
} from "@/lib/gateway.server";

// Server-side only: the gateway base URL / API key / webhook secret are stored
// in public.gateway_settings (RLS on, no policies) and never returned to the browser.

async function currentBusiness(supabase: {
  from: (t: string) => any;
}): Promise<{ id: string; name: string }> {
  const { data, error } = await supabase.from("businesses").select("id,name").limit(1).single();
  if (error || !data) throw new Error("Business not found");
  return data as { id: string; name: string };
}

export type GatewayStatus = {
  connected: boolean;
  base_url: string | null;
  api_key_hint: string | null;
  business_name: string | null;
  whatsapp_connected: boolean;
  webhook_url: string | null;
  webhook_registered: boolean;
  is_active: boolean;
  messaging_provider: "meta" | "gateway";
};

export const getGatewayStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ status: GatewayStatus }> => {
    const { supabase } = context;
    const biz = await currentBusiness(supabase);
    const { data: bizRow } = await supabase
      .from("businesses")
      .select("messaging_provider")
      .eq("id", biz.id)
      .maybeSingle();
    const settings = await loadGatewaySettings(biz.id);
    return {
      status: {
        connected: Boolean(settings),
        base_url: settings?.base_url ?? null,
        api_key_hint: settings ? `••••${settings.api_key.slice(-4)}` : null,
        business_name: settings?.business_name ?? null,
        whatsapp_connected: settings?.whatsapp_connected ?? false,
        webhook_url: settings?.webhook_url ?? null,
        webhook_registered: Boolean(settings?.webhook_secret),
        is_active: settings?.is_active ?? false,
        messaging_provider: bizRow?.messaging_provider === "gateway" ? "gateway" : "meta",
      },
    };
  });

/** Save credentials, verify them, register the receiving webhook, cache templates. */
export const connectGateway = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        baseUrl: z.string().trim().url().max(300),
        apiKey: z.string().trim().min(8).max(300).optional(),
        appUrl: z.string().trim().url().max(300),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const biz = await currentBusiness(supabase);
    const existing = await loadGatewaySettings(biz.id);
    const apiKey = data.apiKey && data.apiKey.length > 0 ? data.apiKey : existing?.api_key;
    if (!apiKey) throw new Error("An API key is required to connect the gateway.");
    const baseUrl = normalizeBaseUrl(data.baseUrl);

    // 1. Verify the credentials
    const check = await gatewayFetch<any>({ baseUrl, apiKey, path: "/api/v1/settings" });
    if (!check.ok) {
      throw new Error(
        check.status === 401
          ? "Connection failed — check your Base URL and API Key."
          : `Connection failed — ${check.error}`,
      );
    }
    const info = check.data ?? {};
    const businessName: string | null = info?.business?.name ?? info?.name ?? null;
    const whatsappConnected = Boolean(info?.whatsapp?.connected);

    // 2. Register our receiving webhook (non-fatal)
    const webhookUrl = `${normalizeBaseUrl(data.appUrl)}/api/public/gateway/webhook`;
    let webhookSecret: string | null = existing?.webhook_secret ?? null;
    let webhookWarning: string | null = null;
    const reg = await gatewayFetch<{ webhookSecret?: string }>({
      baseUrl,
      apiKey,
      path: "/api/v1/webhooks/register",
      method: "POST",
      body: { url: webhookUrl },
    });
    if (reg.ok && reg.data?.webhookSecret) {
      webhookSecret = reg.data.webhookSecret;
    } else if (reg.ok) {
      webhookWarning = "Webhook registered but the gateway returned no secret — inbound messages can't be verified yet.";
    } else {
      webhookWarning = /already|exists|registered|conflict/i.test(reg.error ?? "")
        ? "This gateway account already has a different webhook registered. Only one receiving app is supported at a time — remove the other registration, then reconnect."
        : `Sending will work, but receiving replies is not set up: ${reg.error}`;
    }

    const { error: upsertErr } = await supabase
      .from("gateway_settings")
      .upsert(
        {
          business_id: biz.id,
          base_url: baseUrl,
          api_key: (await encryptSecret(apiKey)) ?? apiKey,
          webhook_secret: webhookSecret ? ((await encryptSecret(webhookSecret)) ?? webhookSecret) : null,
          webhook_url: webhookSecret ? webhookUrl : (existing?.webhook_url ?? null),
          webhook_registered_at: webhookSecret ? new Date().toISOString() : existing?.webhook_registered_at ?? null,
          business_name: businessName,
          whatsapp_connected: whatsappConnected,
          is_active: true,
          last_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "business_id" },
      );
    if (upsertErr) throw new Error(upsertErr.message);

    await writeAudit({
      businessId: biz.id,
      actorId: context.userId,
      action: "gateway.connected",
      targetType: "gateway_settings",
      targetId: biz.id,
      detail: { base_url: baseUrl, webhook_registered: Boolean(webhookSecret) },
    });

    return {
      businessName,
      whatsappConnected,
      webhookRegistered: Boolean(webhookSecret),
      webhookUrl,
      webhookWarning,
    };
  });

export const disconnectGateway = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const biz = await currentBusiness(supabase);
    const settings = await loadGatewaySettings(biz.id);
    if (settings) {
      await gatewayFetch({
        baseUrl: settings.base_url,
        apiKey: settings.api_key,
        path: "/api/v1/webhooks/register",
        method: "DELETE",
      });
    }
    const { error } = await supabase.from("gateway_settings").delete().eq("business_id", biz.id);
    if (error) throw new Error(error.message);
    await supabase.from("businesses").update({ messaging_provider: "meta" }).eq("id", biz.id);
    await writeAudit({
      businessId: biz.id,
      actorId: context.userId,
      action: "gateway.disconnected",
      targetType: "gateway_settings",
      targetId: biz.id,
      detail: {},
    });
    return { ok: true };
  });

/** Switch which integration path outbound messages use. */
export const setMessagingProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ provider: z.enum(["meta", "gateway"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const biz = await currentBusiness(supabase);
    if (data.provider === "gateway") {
      const settings = await loadGatewaySettings(biz.id);
      if (!settings) throw new Error("Connect the Nexus gateway before switching to it.");
    }
    const { error } = await supabase
      .from("businesses")
      .update({ messaging_provider: data.provider })
      .eq("id", biz.id);
    if (error) throw new Error(error.message);
    await writeAudit({
      businessId: biz.id,
      actorId: context.userId,
      action: "messaging_provider.changed",
      targetType: "business",
      targetId: biz.id,
      detail: { provider: data.provider },
    });
    return { provider: data.provider };
  });

export const listGatewayTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const biz = await currentBusiness(context.supabase);
    const settings = await loadGatewaySettings(biz.id);
    if (!settings) return { templates: [] as any[] };
    const res = await gatewayFetch<any>({
      baseUrl: settings.base_url,
      apiKey: settings.api_key,
      path: "/api/v1/templates",
    });
    if (!res.ok) throw new Error(res.error ?? "Failed to load gateway templates");
    const list = Array.isArray(res.data) ? res.data : (res.data?.templates ?? []);
    return { templates: list as any[] };
  });

/** Register / update a contact's consent with the gateway and store it locally. */
export const saveContactConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        contactId: z.string().uuid(),
        optIn: z.boolean(),
        optInSource: z.string().trim().max(200).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: contact, error } = await supabase
      .from("contacts")
      .select("id,name,phone,business_id")
      .eq("id", data.contactId)
      .single();
    if (error || !contact) throw new Error("Contact not found");
    if (data.optIn && !data.optInSource) throw new Error("Tell us how consent was obtained.");

    const phone = toE164(contact.phone);
    if (!isE164(phone)) throw new Error("Contact phone must be in E.164 format, e.g. +254712345678");

    let synced: string | null = null;
    const settings = await loadGatewaySettings(contact.business_id);
    if (settings) {
      await gatewayUpsertContact({
        businessId: contact.business_id,
        phone,
        displayName: contact.name,
        optIn: data.optIn,
        optInSource: data.optInSource || "not specified",
      });
      synced = new Date().toISOString();
    }

    const { error: updErr } = await supabase
      .from("contacts")
      .update({
        opt_in: data.optIn,
        opt_in_source: data.optInSource || null,
        gateway_synced_at: synced,
        phone,
      })
      .eq("id", contact.id);
    if (updErr) throw new Error(updErr.message);
    return { ok: true, synced: Boolean(synced) };
  });

export const listUnmatchedGatewayMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("gateway_unmatched_messages")
      .select("*")
      .is("resolved_at", null)
      .order("received_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { messages: data ?? [] };
  });
