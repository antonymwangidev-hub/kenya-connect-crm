// supabase/functions/whatsapp-webhook/index.ts
//
// Meta WhatsApp Cloud API webhook.
//  - GET  -> verification handshake (hub.mode / hub.verify_token / hub.challenge)
//  - POST -> inbound message events
//
// Multi-tenant: the business is resolved from value.metadata.phone_number_id
// against public.whatsapp_connections. Contacts are upserted on
// (business_id, phone). Conversations are NOT created here — DB triggers
// (trg_contact_create_conversation, trg_message_set_conversation,
// trg_message_update_conversation) already handle that on insert.
//
// Required secrets (`supabase secrets set ...`):
//   WHATSAPP_VERIFY_TOKEN   - chosen by you, entered in Meta dashboard too
//   WHATSAPP_APP_SECRET     - from Meta App Dashboard, used to verify X-Hub-Signature-256
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// the Supabase Edge Functions runtime — no need to set them manually.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN")!;
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface WaMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  button?: { text?: string };
  [key: string]: unknown;
}

interface WaContactInfo {
  profile?: { name?: string };
  wa_id: string;
}

interface WaValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  messages?: WaMessage[];
  contacts?: WaContactInfo[];
  statuses?: unknown[];
}

type BusinessLookup = {
  businessId: string | null;
  phoneNumberId: string | null;
  source: "whatsapp_connections" | "channel_credentials" | "env" | "missing_phone_number_id" | "not_found";
  attempts: Array<Record<string, unknown>>;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // -----------------------------------------------------------------
  // GET — Meta verification handshake
  // -----------------------------------------------------------------
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge ?? "", {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/plain" },
      });
    }
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  // -----------------------------------------------------------------
  // POST — inbound events
  // -----------------------------------------------------------------
  if (req.method === "POST") {
    const rawBody = await req.text();
    const signatureOk = await verifySignature(rawBody, req.headers.get("x-hub-signature-256"));

    let payload: { entry?: Array<{ changes?: Array<{ value?: WaValue }> }> } = {};
    let processingError: string | null = null;

    try {
      payload = JSON.parse(rawBody);

      if (!signatureOk && APP_SECRET) {
        // We still log and 200 (Meta retries aggressively on non-2xx), but we
        // do not process the payload if the signature check failed.
        processingError = "Invalid X-Hub-Signature-256";
      } else {
        for (const entry of payload.entry ?? []) {
          for (const change of entry.changes ?? []) {
            const value = change.value;
            if (!value?.messages?.length) continue; // status callbacks etc — nothing to store

            const businessLookup = await resolveBusiness(value.metadata?.phone_number_id);
            const businessId = businessLookup.businessId;

            for (const message of value.messages) {
              const trace = baseTrace(value, message, businessLookup);
              if (!businessId) {
                processingError = `No business matched phone_number_id ${value.metadata?.phone_number_id ?? "<missing>"}`;
                trace.error = processingError;
                console.warn("WhatsApp inbound routing failed:", JSON.stringify(trace));
                await logWebhook(trace, signatureOk, processingError, null);
                continue;
              }

              try {
                await storeInboundMessage(businessId, message, value.contacts ?? [], trace);
                console.info("WhatsApp inbound stored:", JSON.stringify(trace));
                await logWebhook(trace, signatureOk, null, businessId);
              } catch (err) {
                processingError = err instanceof Error ? err.message : String(err);
                trace.error = processingError;
                console.error("WhatsApp inbound message failed:", JSON.stringify(trace), err);
                await logWebhook(trace, signatureOk, processingError, businessId);
              }
            }
          }
        }
      }
    } catch (err) {
      processingError = err instanceof Error ? err.message : String(err);
      console.error("whatsapp-webhook processing error:", err);
    }

    if (processingError || !hasInboundMessages(payload)) {
      await logWebhook(payload, signatureOk, processingError, null);
    }

    // Always 200 — Meta will retry-storm on non-2xx responses.
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
});

function normalizeWaPhone(value: string): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? `+${digits}` : String(value ?? "").trim();
}

function hasInboundMessages(payload: { entry?: Array<{ changes?: Array<{ value?: WaValue }> }> }): boolean {
  return (payload.entry ?? []).some((entry) =>
    (entry.changes ?? []).some((change) => Boolean(change.value?.messages?.length)),
  );
}

function baseTrace(value: WaValue, message: WaMessage, businessLookup: BusinessLookup): Record<string, unknown> {
  const text = message.text?.body ?? message.button?.text ?? fallbackBody(message.type);
  return {
    event: "inbound_message",
    phone_number_id: value.metadata?.phone_number_id ?? null,
    display_phone_number: value.metadata?.display_phone_number ?? null,
    sender_number: normalizeWaPhone(message.from),
    message_text: text,
    provider_message_id: message.id ?? null,
    business_lookup: businessLookup,
    contact_result: null,
    conversation_lookup_result: null,
    database_insert_result: null,
    error: null,
  };
}

async function resolveBusiness(phoneNumberId: string | undefined): Promise<BusinessLookup> {
  const normalized = phoneNumberId?.trim() || null;
  const attempts: BusinessLookup["attempts"] = [];
  if (!normalized) return { businessId: null, phoneNumberId: null, source: "missing_phone_number_id", attempts };

  const { data: connection, error } = await supabase
    .from("whatsapp_connections")
    .select("business_id,status,connected_at")
    .eq("phone_number_id", normalized)
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  attempts.push({
    source: "whatsapp_connections",
    ok: !error,
    business_id: connection?.business_id ?? null,
    status: connection?.status ?? null,
    error: error?.message ?? null,
  });
  if (connection?.business_id) {
    return { businessId: connection.business_id, phoneNumberId: normalized, source: "whatsapp_connections", attempts };
  }

  const { data: credentials, error: credentialError } = await supabase
    .from("channel_credentials")
    .select("business_id,credentials,is_active")
    .eq("provider", "whatsapp")
    .eq("is_active", true);
  const credentialMatch = (credentials ?? []).find((row) => {
    const creds = (row.credentials ?? {}) as Record<string, string>;
    return String(creds.phone_number_id ?? "").trim() === normalized;
  });
  attempts.push({
    source: "channel_credentials",
    ok: !credentialError,
    active_rows_checked: credentials?.length ?? 0,
    business_id: credentialMatch?.business_id ?? null,
    error: credentialError?.message ?? null,
  });
  if (credentialMatch?.business_id) {
    return { businessId: credentialMatch.business_id, phoneNumberId: normalized, source: "channel_credentials", attempts };
  }

  const envPhoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")?.trim();
  const envBusinessId = Deno.env.get("WHATSAPP_DEFAULT_BUSINESS_ID")?.trim();
  const envMatches = Boolean(envPhoneNumberId && envBusinessId && envPhoneNumberId === normalized);
  attempts.push({
    source: "env",
    ok: envMatches,
    phone_number_id_matches: envPhoneNumberId ? envPhoneNumberId === normalized : false,
    has_default_business_id: Boolean(envBusinessId),
  });
  if (envMatches) return { businessId: envBusinessId!, phoneNumberId: normalized, source: "env", attempts };

  return { businessId: null, phoneNumberId: normalized, source: "not_found", attempts };
}

async function storeInboundMessage(
  businessId: string,
  message: WaMessage,
  contactsInfo: WaContactInfo[],
  trace: Record<string, unknown>,
) {
  const sender = message.from;
  const phone = normalizeWaPhone(sender);
  const phoneVariants = [...new Set([phone, phone.replace(/^\+/, "")])];
  const profileName = contactsInfo.find((c) => c.wa_id === sender)?.profile?.name ?? phone;
  const content = message.text?.body ?? message.button?.text ?? fallbackBody(message.type);
  const createdAt = new Date(Number(message.timestamp) * 1000).toISOString();

  // 1) Find or create the contact, scoped to this business.
  let { data: contact, error: contactLookupError } = await supabase
    .from("contacts")
    .select("id,phone")
    .eq("business_id", businessId)
    .in("phone", phoneVariants)
    .limit(1)
    .maybeSingle();

  if (contactLookupError) {
    console.error("Error looking up contact:", contactLookupError);
    throw contactLookupError;
  }

  let contactCreated = false;
  const matchedPhone = contact?.phone ?? null;
  if (!contact) {
    const { data: created, error: createError } = await supabase
      .from("contacts")
      .insert({ business_id: businessId, phone, name: profileName })
      .select("id,phone")
      .single();
    if (createError) {
      console.error("Error creating contact:", createError);
      throw createError;
    }
    contact = created;
    contactCreated = true;
  } else if (contact.phone !== phone) {
    const { error: updateError } = await supabase.from("contacts").update({ phone }).eq("id", contact.id);
    if (updateError) console.warn("WhatsApp contact phone normalization failed:", updateError.message);
  }

  trace.contact_result = { id: contact.id, created: contactCreated, phone, matchedPhone };

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id,business_id,contact_id,last_message_at,last_message_preview,last_direction,unread_count")
    .eq("contact_id", contact.id)
    .maybeSingle();
  trace.conversation_lookup_result = {
    found: Boolean(conversation),
    conversation_id: conversation?.id ?? null,
    business_id: conversation?.business_id ?? null,
    unread_count: conversation?.unread_count ?? null,
    error: conversationError?.message ?? null,
  };
  if (conversationError) throw conversationError;

  if (message.id) {
    const { data: duplicate, error: duplicateError } = await supabase
      .from("messages")
      .select("id,conversation_id,created_at")
      .eq("provider_message_id", message.id)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) {
      trace.database_insert_result = {
        ok: true,
        skipped_duplicate: true,
        existing_message_id: duplicate.id,
        conversation_id: duplicate.conversation_id,
      };
      return;
    }
  }

  // 2) Insert the message. conversation_id is auto-populated by
  //    trg_message_set_conversation; last_message_* on conversations is
  //    auto-updated by trg_message_update_conversation.
  const { data: inserted, error: messageError } = await supabase
    .from("messages")
    .insert({
      contact_id: contact.id,
      direction: "inbound",
      content,
      channel: "whatsapp",
      provider_message_id: message.id ?? null,
      created_at: createdAt,
    })
    .select("id,conversation_id,created_at")
    .single();

  trace.database_insert_result = {
    ok: !messageError,
    message_id: inserted?.id ?? null,
    conversation_id: inserted?.conversation_id ?? null,
    created_at: inserted?.created_at ?? null,
    error: messageError?.message ?? null,
  };

  if (messageError) {
    console.error("Error inserting message:", messageError);
    throw messageError;
  }

  if (inserted?.conversation_id) {
    const { data: conversationAfter } = await supabase
      .from("conversations")
      .select("id,last_message_at,last_message_preview,last_direction,unread_count")
      .eq("id", inserted.conversation_id)
      .maybeSingle();
    trace.conversation_after_insert = conversationAfter ?? null;
  } else {
    trace.conversation_after_insert = null;
    trace.error = "Message inserted without conversation_id";
  }
}

function fallbackBody(type: string): string {
  const known = ["image", "audio", "video", "document", "location", "sticker", "contacts"];
  return known.includes(type) ? `[${type}]` : `[unsupported message: ${type}]`;
}

async function logWebhook(
  payload: unknown,
  signatureOk: boolean,
  error: string | null,
  businessId: string | null,
) {
  const { error: logError } = await supabase.from("webhook_logs").insert({
    business_id: businessId,
    source: "whatsapp",
    payload: payload ?? {},
    signature_ok: signatureOk,
    processed_at: new Date().toISOString(),
    error,
  });
  if (logError) console.error("Error writing webhook_logs:", logError);
}

// Verifies Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body
// using the app secret). Returns true if APP_SECRET is unset, so local/dev
// setups without it configured still function — set WHATSAPP_APP_SECRET in
// production to enforce this check.
async function verifySignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!APP_SECRET) return true;
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expectedHex = signatureHeader.slice("sha256=".length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computedHex = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(computedHex, expectedHex);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
