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

            const businessId = await resolveBusinessId(value.metadata?.phone_number_id);
            if (!businessId) {
              processingError = `No whatsapp_connections row for phone_number_id ${value.metadata?.phone_number_id}`;
              continue;
            }

            for (const message of value.messages) {
              await storeInboundMessage(businessId, message, value.contacts ?? []);
            }
          }
        }
      }
    } catch (err) {
      processingError = err instanceof Error ? err.message : String(err);
      console.error("whatsapp-webhook processing error:", err);
    }

    await logWebhook(payload, signatureOk, processingError);

    // Always 200 — Meta will retry-storm on non-2xx responses.
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
});

async function resolveBusinessId(phoneNumberId: string | undefined): Promise<string | null> {
  if (!phoneNumberId) return null;
  const { data, error } = await supabase
    .from("whatsapp_connections")
    .select("business_id")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (error) {
    console.error("Error resolving business from phone_number_id:", error);
    return null;
  }
  return data?.business_id ?? null;
}

async function storeInboundMessage(
  businessId: string,
  message: WaMessage,
  contactsInfo: WaContactInfo[],
) {
  const phone = message.from;
  const profileName = contactsInfo.find((c) => c.wa_id === phone)?.profile?.name ?? phone;
  const content = message.text?.body ?? fallbackBody(message.type);
  const createdAt = new Date(Number(message.timestamp) * 1000).toISOString();

  // 1) Find or create the contact, scoped to this business.
  const { data: contact, error: upsertError } = await supabase
    .from("contacts")
    .upsert(
      { business_id: businessId, phone, name: profileName },
      { onConflict: "business_id,phone", ignoreDuplicates: false },
    )
    .select("id")
    .single();

  if (upsertError) {
    console.error("Error upserting contact:", upsertError);
    throw upsertError;
  }

  // 2) Insert the message. conversation_id is auto-populated by
  //    trg_message_set_conversation; last_message_* on conversations is
  //    auto-updated by trg_message_update_conversation.
  const { error: messageError } = await supabase
    .from("messages")
    .upsert(
      {
        contact_id: contact.id,
        direction: "inbound",
        content,
        channel: "whatsapp",
        provider_message_id: message.id,
        created_at: createdAt,
      },
      { onConflict: "provider_message_id", ignoreDuplicates: true },
    );

  if (messageError) {
    console.error("Error inserting message:", messageError);
    throw messageError;
  }
}

function fallbackBody(type: string): string {
  const known = ["image", "audio", "video", "document", "location", "sticker", "contacts"];
  return known.includes(type) ? `[${type}]` : `[unsupported message: ${type}]`;
}

async function logWebhook(payload: unknown, signatureOk: boolean, error: string | null) {
  const { error: logError } = await supabase.from("webhook_logs").insert({
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
