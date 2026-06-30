import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GRAPH_VERSION = "v23.0";

type WaComponent = {
  type: string;
  format?: string;
  text?: string;
  example?: Record<string, unknown>;
  buttons?: Array<Record<string, unknown>>;
};

type MetaTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  components?: WaComponent[];
};

async function resolveWaConfig(businessId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: conn } = await supabaseAdmin
    .from("whatsapp_connections")
    .select("phone_number_id,waba_id,meta")
    .eq("business_id", businessId)
    .eq("status", "connected")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: cred } = await supabaseAdmin
    .from("channel_credentials")
    .select("credentials,is_active")
    .eq("business_id", businessId)
    .eq("provider", "whatsapp")
    .maybeSingle();
  const credBag = (cred?.is_active ? (cred.credentials as Record<string, string>) : null) ?? {};
  const meta = (conn?.meta ?? {}) as Record<string, string>;
  const token = meta.access_token ?? credBag.access_token ?? process.env.WHATSAPP_ACCESS_TOKEN;
  const wabaId = conn?.waba_id ?? credBag.waba_id ?? process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const phoneNumberId = conn?.phone_number_id ?? credBag.phone_number_id ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  return { token, wabaId, phoneNumberId };
}

export const listWhatsappTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("whatsapp_templates")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return { templates: data ?? [] };
  });

export const syncWhatsappTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: biz } = await supabase
      .from("businesses").select("id").eq("owner_id", userId).limit(1).single();
    if (!biz) throw new Error("Business not found");

    const { token, wabaId } = await resolveWaConfig(biz.id);
    if (!token || !wabaId) {
      await supabase.from("whatsapp_template_sync_logs").insert({
        business_id: biz.id, status: "error", error: "WhatsApp not connected",
      });
      throw new Error("Connect WhatsApp first (missing access token or WABA ID).");
    }

    const all: MetaTemplate[] = [];
    let url: string | null =
      `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates?limit=200&fields=name,language,status,category,components,id`;
    try {
      while (url) {
        const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const txt = await res.text();
        if (!res.ok) throw new Error(`Meta API ${res.status}: ${txt.slice(0, 200)}`);
        const json: { data?: MetaTemplate[]; paging?: { next?: string } } = JSON.parse(txt);
        all.push(...(json.data ?? []));
        url = json.paging?.next ?? null;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sync failed";
      await supabase.from("whatsapp_template_sync_logs").insert({
        business_id: biz.id, status: "error", error: msg.slice(0, 500),
      });
      throw new Error(msg);
    }

    const rows = all.map((t) => ({
      business_id: biz.id,
      waba_id: wabaId,
      meta_template_id: t.id,
      name: t.name,
      language: t.language,
      category: t.category ?? null,
      status: t.status,
      components: (t.components ?? []) as unknown as never,
      last_synced_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error: upErr } = await supabase
        .from("whatsapp_templates")
        .upsert(rows, { onConflict: "business_id,name,language" });
      if (upErr) throw new Error(upErr.message);
    }

    await supabase.from("whatsapp_template_sync_logs").insert({
      business_id: biz.id, status: "ok", synced_count: rows.length,
    });

    return { count: rows.length };
  });

const VariableValue = z.union([z.string(), z.object({ link: z.string().url() }).passthrough()]);

export const sendWhatsappTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        contactId: z.string().uuid(),
        templateId: z.string().uuid(),
        variables: z
          .object({
            header: z.array(VariableValue).optional(),
            body: z.array(z.string()).optional(),
            buttons: z.array(z.object({ index: z.number(), value: z.string() })).optional(),
          })
          .default({}),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: contact, error: cErr } = await supabase
      .from("contacts").select("id,phone,business_id").eq("id", data.contactId).single();
    if (cErr || !contact) throw new Error("Contact not found");

    const { data: tpl, error: tErr } = await supabase
      .from("whatsapp_templates").select("*").eq("id", data.templateId).single();
    if (tErr || !tpl) throw new Error("Template not found");
    if (tpl.status !== "APPROVED") throw new Error("Template is not approved");

    const { token, phoneNumberId } = await resolveWaConfig(contact.business_id);
    if (!token || !phoneNumberId) throw new Error("WhatsApp not configured for this business");

    // Build components payload
    const components: Array<Record<string, unknown>> = [];
    const tplComponents = (tpl.components as WaComponent[]) ?? [];

    const header = tplComponents.find((c) => c.type === "HEADER");
    if (header && data.variables.header && data.variables.header.length > 0) {
      const fmt = (header.format ?? "TEXT").toUpperCase();
      const params = data.variables.header.map((v) => {
        if (fmt === "TEXT") return { type: "text", text: String(v) };
        if (fmt === "IMAGE") return { type: "image", image: typeof v === "string" ? { link: v } : v };
        if (fmt === "VIDEO") return { type: "video", video: typeof v === "string" ? { link: v } : v };
        if (fmt === "DOCUMENT") return { type: "document", document: typeof v === "string" ? { link: v } : v };
        return { type: "text", text: String(v) };
      });
      components.push({ type: "header", parameters: params });
    }

    if (data.variables.body && data.variables.body.length > 0) {
      components.push({
        type: "body",
        parameters: data.variables.body.map((v) => ({ type: "text", text: v })),
      });
    }

    if (data.variables.buttons && data.variables.buttons.length > 0) {
      for (const b of data.variables.buttons) {
        components.push({
          type: "button",
          sub_type: "url",
          index: String(b.index),
          parameters: [{ type: "text", text: b.value }],
        });
      }
    }

    const payload = {
      messaging_product: "whatsapp",
      to: contact.phone.replace(/^\+/, ""),
      type: "template",
      template: {
        name: tpl.name,
        language: { code: tpl.language },
        ...(components.length > 0 ? { components } : {}),
      },
    };

    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      let friendly = "Failed to send template";
      try {
        const j = JSON.parse(text) as { error?: { code?: number; message?: string } };
        const code = j.error?.code;
        if (code === 190) friendly = "WhatsApp access token expired. Reconnect WhatsApp.";
        else if (code === 132000 || code === 132001 || code === 132005) friendly = "Template parameters do not match the approved template.";
        else if (code === 131026) friendly = "Recipient is not opted in or unreachable on WhatsApp.";
        else if (code === 130429 || code === 80007) friendly = "WhatsApp rate limit reached. Try again shortly.";
        else if (j.error?.message) friendly = j.error.message;
      } catch { /* keep default */ }
      throw new Error(friendly);
    }
    let json: { messages?: Array<{ id?: string }> } = {};
    try { json = JSON.parse(text); } catch { /* ignore */ }
    const providerId = json.messages?.[0]?.id ?? null;

    // Render preview body for the inbox
    const bodyComp = tplComponents.find((c) => c.type === "BODY");
    let preview = bodyComp?.text ?? `[Template] ${tpl.name}`;
    (data.variables.body ?? []).forEach((v, i) => {
      preview = preview.replace(new RegExp(`\\{\\{\\s*${i + 1}\\s*\\}\\}`, "g"), v);
    });

    const { data: inserted, error: insErr } = await supabase
      .from("messages")
      .insert({
        contact_id: contact.id,
        direction: "outbound",
        content: preview,
        channel: "whatsapp",
        provider_message_id: providerId,
      })
      .select()
      .single();
    if (insErr) throw new Error(insErr.message);

    return { message: inserted, providerMessageId: providerId };
  });
