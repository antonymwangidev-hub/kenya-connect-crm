import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret } from "@/lib/crypto.server";

// Nexus WhatsApp Gateway — server-only client.
// The base URL / API key / webhook secret live in public.gateway_settings,
// which has RLS enabled and NO policies: only service-role code can read it,
// so the API key never reaches the browser.

export type GatewaySettings = {
  id: string;
  business_id: string;
  base_url: string;
  api_key: string;
  webhook_secret: string | null;
  webhook_url: string | null;
  webhook_token: string;
  webhook_secret_source: string;
  webhook_registered_at: string | null;
  business_name: string | null;
  whatsapp_connected: boolean;
  is_active: boolean;
};

export function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

export function toE164(phone: string) {
  const trimmed = String(phone ?? "").trim();
  if (trimmed.startsWith("+")) return `+${trimmed.slice(1).replace(/\D/g, "")}`;
  const digits = trimmed.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

export function isE164(phone: string) {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

export async function loadGatewaySettings(businessId: string): Promise<GatewaySettings | null> {
  const { data } = await supabaseAdmin
    .from("gateway_settings")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();
  if (!data) return null;
  const apiKey = (await decryptSecret(data.api_key)) ?? data.api_key;
  const webhookSecret = data.webhook_secret
    ? ((await decryptSecret(data.webhook_secret)) ?? data.webhook_secret)
    : null;
  return { ...data, api_key: apiKey, webhook_secret: webhookSecret } as GatewaySettings;
}

export async function getMessagingProvider(businessId: string): Promise<"meta" | "gateway"> {
  const { data } = await supabaseAdmin
    .from("businesses")
    .select("messaging_provider")
    .eq("id", businessId)
    .maybeSingle();
  return data?.messaging_provider === "gateway" ? "gateway" : "meta";
}

type GatewayCall = {
  baseUrl: string;
  apiKey: string;
  path: string;
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
};

export type GatewayResponse<T = any> = {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
};

export async function gatewayFetch<T = any>({
  baseUrl,
  apiKey,
  path,
  method = "GET",
  body,
}: GatewayCall): Promise<GatewayResponse<T>> {
  let res: Response;
  try {
    res = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
      method,
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: `Network error contacting the gateway: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const raw = await res.text();
  let parsed: any = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const message =
      (parsed && (parsed.error || parsed.message)) ||
      (raw ? raw.slice(0, 300) : `Gateway returned ${res.status}`);
    return { ok: false, status: res.status, data: parsed, error: String(message) };
  }
  if (raw && parsed === null) {
    return { ok: false, status: res.status, data: null, error: "Gateway returned malformed JSON" };
  }
  return { ok: true, status: res.status, data: (parsed?.data ?? parsed) as T, error: null };
}

async function requireGateway(businessId: string) {
  const settings = await loadGatewaySettings(businessId);
  if (!settings || !settings.is_active) {
    throw new Error("Nexus gateway is not connected for this workspace.");
  }
  return settings;
}

/** Register/refresh a contact's consent with the gateway. Required before sending. */
export async function gatewayUpsertContact(opts: {
  businessId: string;
  phone: string;
  displayName?: string | null;
  optIn: boolean;
  optInSource: string;
}) {
  const settings = await requireGateway(opts.businessId);
  const phone = toE164(opts.phone);
  if (!isE164(phone)) throw new Error(`Phone must be in E.164 format (e.g. +254712345678): ${opts.phone}`);
  const res = await gatewayFetch({
    baseUrl: settings.base_url,
    apiKey: settings.api_key,
    path: "/api/v1/contacts",
    method: "POST",
    body: {
      phone,
      displayName: opts.displayName ?? phone,
      optIn: opts.optIn,
      optInSource: opts.optInSource,
    },
  });
  if (!res.ok) throw new Error(res.error ?? "Failed to register contact with the gateway");
  return res.data;
}

/** Free-form WhatsApp/SMS send through the gateway (24h window applies to WhatsApp). */
export async function gatewaySendText(
  businessId: string,
  toPhone: string,
  body: string,
  channel: "whatsapp" | "sms" = "whatsapp",
) {
  const settings = await requireGateway(businessId);
  const to = toE164(toPhone);
  const res = await gatewayFetch<{ messageId?: string; status?: string }>({
    baseUrl: settings.base_url,
    apiKey: settings.api_key,
    path: "/api/v1/messages/send",
    method: "POST",
    body: { to, channel, body },
  });
  if (!res.ok) throw new Error(gatewayErrorText(res));
  return { messageId: res.data?.messageId ?? null, status: res.data?.status ?? "QUEUED" };
}

/** Template send through the gateway (works outside the 24h window). */
export async function gatewaySendTemplate(opts: {
  businessId: string;
  toPhone: string;
  templateName: string;
  languageCode: string;
  variables: string[];
}) {
  const settings = await requireGateway(opts.businessId);
  const res = await gatewayFetch<{ messageId?: string; status?: string }>({
    baseUrl: settings.base_url,
    apiKey: settings.api_key,
    path: "/api/v1/messages/send",
    method: "POST",
    body: {
      to: toE164(opts.toPhone),
      channel: "whatsapp",
      templateName: opts.templateName,
      languageCode: opts.languageCode,
      variables: opts.variables,
    },
  });
  if (!res.ok) throw new Error(gatewayErrorText(res));
  return { messageId: res.data?.messageId ?? null, status: res.data?.status ?? "QUEUED" };
}

/**
 * Trigger the gateway's WhatsApp typing indicator for a contact.
 * The gateway resolves the latest inbound WhatsApp message itself — never send
 * a wamid/providerMessageId. 404 (unknown contact) and 403 (no prior inbound
 * message) are expected and treated as silent no-ops.
 */
export async function gatewaySendTyping(businessId: string, toPhone: string): Promise<{ ok: boolean }> {
  const settings = await loadGatewaySettings(businessId);
  if (!settings || !settings.is_active) return { ok: false };
  const to = toE164(toPhone);
  if (!isE164(to)) return { ok: false };
  const res = await gatewayFetch({
    baseUrl: settings.base_url,
    apiKey: settings.api_key,
    path: "/api/v1/messages/typing",
    method: "POST",
    body: { to },
  });
  if (!res.ok && res.status !== 404 && res.status !== 403) {
    console.warn(`[gateway] typing indicator failed (${res.status}): ${res.error}`);
  }
  return { ok: res.ok };
}

export function gatewayErrorText(res: GatewayResponse): string {
  const base = res.error ?? "Gateway send failed";
  if (res.status === 403 && /opt/i.test(base)) {
    return `${base} — register their consent in the contact's details first.`;
  }
  if (res.status === 403) {
    return `${base} — the 24-hour reply window is closed, send an approved template instead.`;
  }
  return base;
}
