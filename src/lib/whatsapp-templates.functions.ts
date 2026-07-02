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

type AccountRow = {
  id: string;
  business_id: string;
  business_name: string;
  waba_id: string;
  phone_number_id: string;
  access_token: string | null;
  status: string;
};

// SAFE — never returns access_token to client.
const SAFE_ACCOUNT_COLS =
  "id,business_id,business_name,waba_id,phone_number_id,status,created_at,updated_at";

async function loadAccountForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  accountId: string,
): Promise<AccountRow> {
  // Verify business ownership via join
  const { data: biz } = await supabase
    .from("businesses").select("id").eq("owner_id", userId);
  const bizIds = (biz as Array<{ id: string }> | null)?.map((b) => b.id) ?? [];
  if (bizIds.length === 0) throw new Error("Business not found");

  const { data, error } = await supabase
    .from("whatsapp_business_accounts")
    .select("id,business_id,business_name,waba_id,phone_number_id,access_token,status")
    .eq("id", accountId)
    .in("business_id", bizIds)
    .maybeSingle();
  if (error || !data) throw new Error("WhatsApp account not found");
  return data as AccountRow;
}

// ---------- Accounts ----------

export const listWhatsappAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("whatsapp_business_accounts")
      .select(SAFE_ACCOUNT_COLS)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { accounts: data ?? [] };
  });

// ---------- Templates ----------

export const listWhatsappTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ accountId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("whatsapp_templates")
      .select("*")
      .eq("business_account_id", data.accountId)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return { templates: rows ?? [] };
  });

export const syncWhatsappTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ accountId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const account = await loadAccountForUser(supabase, userId, data.accountId);

    const token = account.access_token ?? process.env.WHATSAPP_ACCESS_TOKEN;
    if (!token) {
      await supabase.from("whatsapp_template_sync_logs").insert({
        business_id: account.business_id, status: "error", error: "Missing access token",
      });
      throw new Error("This WhatsApp account has no access token. Reconnect via Meta Embedded Signup.");
    }
    if (!account.waba_id) {
      throw new Error("This account has no WABA ID.");
    }

    const all: MetaTemplate[] = [];
    // ALWAYS use the SELECTED account's WABA — never a global one.
    let url: string | null =
      `https://graph.facebook.com/${GRAPH_VERSION}/${account.waba_id}/message_templates?limit=200&fields=name,language,status,category,components,id`;
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
        business_id: account.business_id, status: "error", error: msg.slice(0, 500),
      });
      throw new Error(msg);
    }

    const rows = all.map((t) => ({
      business_id: account.business_id,
      business_account_id: account.id,
      waba_id: account.waba_id,
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
        .upsert(rows, { onConflict: "business_account_id,name,language" });
      if (upErr) throw new Error(upErr.message);
    }

    await supabase.from("whatsapp_template_sync_logs").insert({
      business_id: account.business_id, status: "ok", synced_count: rows.length,
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
    const { supabase, userId } = context;

    const { data: contact, error: cErr } = await supabase
      .from("contacts").select("id,phone,business_id").eq("id", data.contactId).single();
    if (cErr || !contact) throw new Error("Contact not found");

    const { data: tpl, error: tErr } = await supabase
      .from("whatsapp_templates").select("*").eq("id", data.templateId).single();
    if (tErr || !tpl) throw new Error("Template not found");
    if (tpl.status !== "APPROVED") throw new Error("Template is not approved");
    if (!tpl.business_account_id) throw new Error("Template is not linked to a WhatsApp account");

    // The template's own account decides the WABA + phone number used to send.
    const account = await loadAccountForUser(supabase, userId, tpl.business_account_id);
    if (account.business_id !== contact.business_id) {
      throw new Error("Template belongs to a different workspace than the contact");
    }

    const token = account.access_token ?? process.env.WHATSAPP_ACCESS_TOKEN;
    if (!token || !account.phone_number_id) {
      throw new Error("WhatsApp account is not fully configured");
    }

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

    // Send via the SELECTED account's phone_number_id (belongs to the same WABA as the template).
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${account.phone_number_id}/messages`, {
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
        if (code === 190) friendly = "WhatsApp access token expired. Reconnect this account.";
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
