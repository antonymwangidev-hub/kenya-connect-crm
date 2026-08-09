import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { decryptSecret } from "@/lib/crypto.server";
import { checkRateLimit } from "@/lib/rate-limit.server";
import { writeAudit } from "@/lib/audit.server";

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0";

function maskToken(t: string | null | undefined) {
  if (!t) return { present: false };
  return { present: true, length: t.length, prefix: t.slice(0, 6), suffix: t.slice(-4) };
}

/**
 * Resolve the access token for Graph API calls against the selected WABA.
 *
 * This intentionally mirrors the working free-form send path in
 * `messaging.functions.ts`: use the token saved on the connected WhatsApp row
 * first, then channel credentials, then the server env fallback. The
 * `whatsapp_business_accounts.access_token` value is only a final legacy
 * fallback because Embedded Signup can store a user OAuth token that later
 * fails with Meta OAuth 190 / subcode 467 ("user logged out").
 */
async function resolveWabaTokenForAccount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  account: AccountRow,
) {
  const { data: conn } = await supabase
    .from("whatsapp_connections")
    .select("meta,connected_at")
    .eq("business_id", account.business_id)
    .eq("status", "connected")
    .eq("waba_id", account.waba_id)
    .eq("phone_number_id", account.phone_number_id)
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const connToken = (
    await decryptSecret(((conn?.meta ?? {}) as Record<string, string>).access_token)
  )?.trim();
  if (connToken) return { token: connToken, source: "whatsapp_connections.meta.access_token" as const };

  const { data: credsRow } = await supabase
    .from("channel_credentials")
    .select("credentials,is_active")
    .eq("business_id", account.business_id)
    .eq("provider", "whatsapp")
    .maybeSingle();
  const creds = ((credsRow?.credentials ?? {}) as Record<string, string>) || {};
  const credsToken = credsRow?.is_active ? (await decryptSecret(creds.access_token))?.trim() ?? null : null;
  const credsPhoneNumberId = creds.phone_number_id?.trim();
  if (credsToken && (!credsPhoneNumberId || credsPhoneNumberId === account.phone_number_id)) {
    return { token: credsToken, source: "channel_credentials.access_token" as const };
  }

  const envToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim() || null;
  if (envToken) return { token: envToken, source: "env:WHATSAPP_ACCESS_TOKEN" as const };

  const accountToken = (await decryptSecret(account.access_token))?.trim() || null;
  if (accountToken) return { token: accountToken, source: "whatsapp_business_accounts.access_token:legacy-fallback" as const };

  return { token: null, source: "none" as const };
}

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

    const { token, source: tokenSource } = await resolveWabaTokenForAccount(supabase, account);
    if (!token) {
      await supabase.from("whatsapp_template_sync_logs").insert({
        business_id: account.business_id, status: "error", error: "Missing access token",
      });
      throw new Error("No WhatsApp access token available (env WHATSAPP_ACCESS_TOKEN missing and account has none).");
    }
    if (!account.waba_id) {
      throw new Error("This account has no WABA ID.");
    }

    const all: MetaTemplate[] = [];
    // ALWAYS use the SELECTED account's WABA — never a global one.
    let url: string | null =
      `https://graph.facebook.com/${GRAPH_VERSION}/${account.waba_id}/message_templates?limit=200&fields=name,language,status,category,components,id`;
    try {
      // Masked debug log — never prints the full token.
      console.log("[wa-template-sync]", {
        wabaId: account.waba_id,
        phoneNumberId: account.phone_number_id,
        tokenSource,
        token: maskToken(token),
        graphVersion: GRAPH_VERSION,
        initialUrl: url,
      });
      while (url) {
        const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const txt = await res.text();
        console.log("[wa-template-sync:response]", { status: res.status, ok: res.ok, bodyPreview: txt.slice(0, 160) });
        if (!res.ok) {
          let parsed: { error?: { code?: number; error_subcode?: number; message?: string } } = {};
          try { parsed = JSON.parse(txt); } catch { /* keep raw */ }
          const code = parsed?.error?.code;
          const subcode = parsed?.error?.error_subcode;
          const metaMsg = parsed?.error?.message ?? txt.slice(0, 200);
          if (res.status === 403 && code === 200) {
            throw new Error(
              `Meta denied template access for WABA ${account.waba_id} (token source: ${tokenSource}). ` +
              `The access token lacks admin permission on this WhatsApp Business Account. Fix in Meta Business Suite: ` +
              `1) In Business Settings → Users → System Users, open the System User whose token is used here and click "Add Assets" → WhatsApp Accounts → select this WABA → grant "Full control". ` +
              `2) Ensure the System User has the "whatsapp_business_management" and "whatsapp_business_messaging" permissions on the generated token. ` +
              `3) If your Business enforces 2FA, enable 2FA on the admin account that owns the System User. ` +
              `Then re-generate the System User token and update WHATSAPP_ACCESS_TOKEN. Raw: ${metaMsg}`
            );
          }
          if (res.status === 401 || subcode === 467) {
            throw new Error(
              `Meta token invalid/expired for WABA ${account.waba_id} (token source: ${tokenSource}). ` +
              `Generate a new permanent System User token and update WHATSAPP_ACCESS_TOKEN. Raw: ${metaMsg}`
            );
          }
          throw new Error(`Meta API ${res.status}: ${metaMsg}`);
        }
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

    const withinLimit = await checkRateLimit("send_template_business", contact.business_id, 600, 60);
    if (!withinLimit) throw new Error("Sending too fast for this workspace. Please retry shortly.");

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

    const { token, source: tokenSource } = await resolveWabaTokenForAccount(supabase, account);
    if (!token || !account.phone_number_id) {
      throw new Error("WhatsApp account is not fully configured");
    }
    console.log("[wa-template-send]", {
      wabaId: account.waba_id,
      phoneNumberId: account.phone_number_id,
      tokenSource,
      token: maskToken(token),
      graphVersion: GRAPH_VERSION,
    });

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

    await writeAudit({
      businessId: contact.business_id,
      actorId: userId,
      action: "template.sent",
      targetType: "contact",
      targetId: contact.id,
      detail: { template: tpl.name, waba_id: account.waba_id, provider_message_id: providerId },
    });

    return { message: inserted, providerMessageId: providerId };
  });
