import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit.server";

// Meta WhatsApp Cloud API webhook.
// Public URL example: https://<project>.lovable.app/api/public/whatsapp/webhook
// Configure this URL in Meta App Dashboard -> WhatsApp -> Configuration.

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return false;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice("sha256=".length);
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(provided, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

type BusinessLookup = {
  businessId: string | null;
  phoneNumberId: string | null;
  source:
    | "whatsapp_connections"
    | "whatsapp_connections_display_phone"
    | "channel_credentials"
    | "channel_credentials_display_phone"
    | "env"
    | "not_found"
    | "missing_phone_number_id";
  attempts: Array<Record<string, unknown>>;
};

type ContactLookup = {
  id: string;
  created: boolean;
  phone: string;
  matchedPhone: string;
};

function whatsappPhone(from: string) {
  const digits = String(from ?? "").replace(/\D/g, "");
  return digits ? `+${digits}` : String(from ?? "").trim();
}

function phoneDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err && "message" in err) return String((err as { message?: unknown }).message);
  return String(err);
}

async function logWebhookEvent({
  businessId,
  signatureOk,
  payload,
  error,
}: {
  businessId: string | null;
  signatureOk: boolean;
  payload: Record<string, unknown>;
  error?: string | null;
}) {
  const { error: logError } = await supabaseAdmin.from("webhook_logs").insert({
    business_id: businessId,
    source: "whatsapp",
    payload: payload as never,
    signature_ok: signatureOk,
    processed_at: new Date().toISOString(),
    error: error ? error.slice(0, 1000) : null,
  });
  if (logError) console.error("WhatsApp webhook log insert failed:", logError);
}

async function maybeBackfillConnectionPhoneId(connectionId: string, phoneNumberId: string | undefined) {
  const normalized = phoneNumberId?.trim();
  if (!normalized) return;
  const { error } = await supabaseAdmin
    .from("whatsapp_connections")
    .update({ phone_number_id: normalized, updated_at: new Date().toISOString() })
    .eq("id", connectionId)
    .is("phone_number_id", null);
  if (error) console.warn("WhatsApp phone_number_id backfill failed:", error.message);
}

async function findBusinessForPhoneNumberId(
  phoneNumberId: string | undefined,
  displayPhoneNumber?: string,
): Promise<BusinessLookup> {
  // Multi-tenant routing: Meta sends value.metadata.phone_number_id for the
  // receiving WhatsApp number. Prefer whatsapp_connections (embedded signup),
  // then display-phone matching for older rows missing phone_number_id,
  // then channel_credentials (manual setup), then an explicit env fallback.
  const normalized = phoneNumberId?.trim() || null;
  const attempts: BusinessLookup["attempts"] = [];
  const displayDigits = phoneDigits(displayPhoneNumber);

  if (!normalized && !displayDigits) {
    return { businessId: null, phoneNumberId: null, source: "missing_phone_number_id", attempts };
  }

  if (normalized) {
    const { data: connection, error: connectionError } = await supabaseAdmin
      .from("whatsapp_connections")
      .select("id,business_id,status,connected_at")
      .eq("phone_number_id", normalized)
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    attempts.push({
      source: "whatsapp_connections",
      ok: !connectionError,
      business_id: connection?.business_id ?? null,
      status: connection?.status ?? null,
      error: connectionError?.message ?? null,
    });
    if (connection?.business_id) {
      return { businessId: connection.business_id, phoneNumberId: normalized, source: "whatsapp_connections", attempts };
    }
  } else {
    attempts.push({ source: "whatsapp_connections", ok: false, skipped: "missing_phone_number_id" });
  }

  if (displayDigits) {
    const { data: displayRows, error: displayError } = await supabaseAdmin
      .from("whatsapp_connections")
      .select("id,business_id,status,phone_number,phone_number_id,connected_at")
      .order("connected_at", { ascending: false, nullsFirst: false })
      .limit(50);
    const displayMatch = (displayRows ?? []).find(
      (row) => phoneDigits(row.phone_number) === displayDigits && row.status !== "disconnected",
    );
    attempts.push({
      source: "whatsapp_connections_display_phone",
      ok: !displayError,
      display_phone_number: displayPhoneNumber ?? null,
      rows_checked: displayRows?.length ?? 0,
      business_id: displayMatch?.business_id ?? null,
      status: displayMatch?.status ?? null,
      matched_connection_id: displayMatch?.id ?? null,
      had_phone_number_id: Boolean(displayMatch?.phone_number_id),
      error: displayError?.message ?? null,
    });
    if (displayMatch?.business_id) {
      await maybeBackfillConnectionPhoneId(displayMatch.id, normalized ?? undefined);
      return {
        businessId: displayMatch.business_id,
        phoneNumberId: normalized,
        source: "whatsapp_connections_display_phone",
        attempts,
      };
    }
  }

  const { data: credentialRows, error: credentialError } = await supabaseAdmin
    .from("channel_credentials")
    .select("business_id,credentials,is_active")
    .eq("provider", "whatsapp")
    .eq("is_active", true);
  const credentialMatch = normalized ? (credentialRows ?? []).find((row) => {
    const credentials = (row.credentials ?? {}) as Record<string, string>;
    return String(credentials.phone_number_id ?? "").trim() === normalized;
  }) : undefined;
  attempts.push({
    source: "channel_credentials",
    ok: !credentialError,
    active_rows_checked: credentialRows?.length ?? 0,
    business_id: credentialMatch?.business_id ?? null,
    error: credentialError?.message ?? null,
  });
  if (credentialMatch?.business_id) {
    return { businessId: credentialMatch.business_id, phoneNumberId: normalized, source: "channel_credentials", attempts };
  }

  if (displayDigits) {
    const credentialDisplayMatch = (credentialRows ?? []).find((row) => {
      const credentials = (row.credentials ?? {}) as Record<string, string>;
      return [credentials.phone_number, credentials.display_phone_number].some(
        (candidate) => phoneDigits(candidate) === displayDigits,
      );
    });
    attempts.push({
      source: "channel_credentials_display_phone",
      ok: !credentialError,
      display_phone_number: displayPhoneNumber ?? null,
      business_id: credentialDisplayMatch?.business_id ?? null,
    });
    if (credentialDisplayMatch?.business_id) {
      return {
        businessId: credentialDisplayMatch.business_id,
        phoneNumberId: normalized,
        source: "channel_credentials_display_phone",
        attempts,
      };
    }
  }

  const envPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const envBusinessId = process.env.WHATSAPP_DEFAULT_BUSINESS_ID?.trim();
  const envMatches = Boolean(envPhoneNumberId && envBusinessId && envPhoneNumberId === normalized);
  attempts.push({
    source: "env",
    ok: envMatches,
    phone_number_id_matches: envPhoneNumberId ? envPhoneNumberId === normalized : false,
    has_default_business_id: Boolean(envBusinessId),
  });
  if (envMatches) {
    return { businessId: envBusinessId!, phoneNumberId: normalized, source: "env", attempts };
  }

  return { businessId: null, phoneNumberId: normalized, source: "not_found", attempts };
}


async function upsertContact(businessId: string, phone: string, name: string | null): Promise<ContactLookup> {
  const phoneVariants = Array.from(new Set([phone, phone.replace(/^\+/, "")].filter(Boolean)));
  let { data: existing, error: existingError } = await supabaseAdmin
    .from("contacts")
    .select("id,phone")
    .eq("business_id", businessId)
    .in("phone", phoneVariants)
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;

  if (!existing) {
    const digits = phoneDigits(phone);
    const { data: possibleMatches, error: possibleError } = await supabaseAdmin
      .from("contacts")
      .select("id,phone")
      .eq("business_id", businessId)
      .limit(1000);
    if (possibleError) throw possibleError;
    existing = (possibleMatches ?? []).find((candidate) => phoneDigits(candidate.phone) === digits) ?? null;
  }

  if (existing) {
    if (existing.phone !== phone) {
      const { error: updateError } = await supabaseAdmin
        .from("contacts")
        .update({ phone })
        .eq("id", existing.id);
      if (updateError) console.warn("WhatsApp contact phone normalization failed:", updateError.message);
    }
    return { id: existing.id, created: false, phone, matchedPhone: existing.phone };
  }
  const { data: created, error } = await supabaseAdmin
    .from("contacts")
    .insert({ business_id: businessId, phone, name: name ?? phone })
    .select("id,phone")
    .single();
  if (error) throw error;
  return { id: created.id, created: true, phone: created.phone, matchedPhone: created.phone };
}

async function getOrCreateConversation(businessId: string, contactId: string) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("conversations")
    .select("id,business_id,contact_id,last_message_at,last_message_preview,last_direction,unread_count")
    .eq("contact_id", contactId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return { conversation: existing, created: false };

  const { data: created, error: createError } = await supabaseAdmin
    .from("conversations")
    .insert({ business_id: businessId, contact_id: contactId })
    .select("id,business_id,contact_id,last_message_at,last_message_preview,last_direction,unread_count")
    .single();

  if (!createError) return { conversation: created, created: true };
  if (createError.code !== "23505") throw createError;

  const { data: raced, error: racedError } = await supabaseAdmin
    .from("conversations")
    .select("id,business_id,contact_id,last_message_at,last_message_preview,last_direction,unread_count")
    .eq("contact_id", contactId)
    .single();
  if (racedError) throw racedError;
  return { conversation: raced, created: false };
}

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      // Meta verification handshake
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
        if (mode === "subscribe" && verifyToken && token === verifyToken) {
          return new Response(challenge ?? "", { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
      },

      POST: async ({ request }) => {
        const ip = clientIp(request);
        const allowed = await checkRateLimit("whatsapp_webhook", ip, 240, 60);
        if (!allowed) return tooManyRequests();

        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (contentLength > 65_536) {
          return new Response("Payload too large", { status: 413 });
        }

        const rawBody = await request.text();
        const sig = request.headers.get("x-hub-signature-256");
        if (!verifySignature(rawBody, sig)) {
          await logWebhookEvent({
            businessId: null,
            signatureOk: false,
            payload: { event: "invalid_signature", signature_present: Boolean(sig) },
            error: "Invalid X-Hub-Signature-256",
          });
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: any;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          await logWebhookEvent({
            businessId: null,
            signatureOk: true,
            payload: { event: "bad_json" },
            error: "Bad JSON",
          });
          return new Response("Bad JSON", { status: 400 });
        }

        try {
          const entries = payload?.entry ?? [];
          for (const entry of entries) {
            for (const change of entry?.changes ?? []) {
              const value = change?.value ?? {};
              const phoneNumberId: string | undefined = value?.metadata?.phone_number_id;
              const displayPhoneNumber: string | undefined = value?.metadata?.display_phone_number;
              const businessLookup = await findBusinessForPhoneNumberId(phoneNumberId, displayPhoneNumber);
              const businessId = businessLookup.businessId;

              const contactsMeta: Array<{ wa_id: string; profile?: { name?: string } }> =
                value?.contacts ?? [];
              const nameByWaId = new Map<string, string>();
              for (const c of contactsMeta) {
                if (c?.wa_id && c?.profile?.name) nameByWaId.set(c.wa_id, c.profile.name);
              }

              const messages: any[] = value?.messages ?? [];
              for (const m of messages) {
                const from: string = m?.from;
                if (!from) continue;
                const phone = whatsappPhone(from);
                const mediaKind = (
                  ["image", "video", "audio", "document", "sticker"] as const
                ).find((k) => m?.[k]);
                const mediaNode = mediaKind ? m[mediaKind] : null;
                const text: string =
                  m?.text?.body ??
                  m?.button?.text ??
                  mediaNode?.caption ??
                  (mediaKind ? "" : `[${m?.type ?? "message"}]`);
                const providerId: string | null = m?.id ?? null;

                const trace: Record<string, unknown> = {
                  event: "inbound_message",
                  phone_number_id: phoneNumberId ?? null,
                  display_phone_number: displayPhoneNumber ?? null,
                  sender_number: phone,
                  message_text: text,
                  provider_message_id: providerId,
                  business_lookup: businessLookup,
                  contact_result: null,
                  conversation_lookup_result: null,
                  database_insert_result: null,
                  error: null,
                };

                if (!businessId) {
                  const error = `No business matched phone_number_id ${phoneNumberId ?? "<missing>"}`;
                  trace.error = error;
                  console.warn("WhatsApp inbound routing failed:", JSON.stringify(trace));
                  await logWebhookEvent({ businessId: null, signatureOk: true, payload: trace, error });
                  continue;
                }

                try {
                  const contact = await upsertContact(
                    businessId,
                    phone,
                    nameByWaId.get(from) ?? null,
                  );
                  trace.contact_result = contact;

                  const { conversation, created: conversationCreated } = await getOrCreateConversation(businessId, contact.id);
                  trace.conversation_lookup_result = {
                    found: Boolean(conversation),
                    conversation_id: conversation?.id ?? null,
                    business_id: conversation?.business_id ?? null,
                    unread_count: conversation?.unread_count ?? null,
                    created: conversationCreated,
                    error: null,
                  };

                  if (providerId) {
                    const { data: duplicate, error: duplicateError } = await supabaseAdmin
                      .from("messages")
                      .select("id,conversation_id,created_at")
                      .eq("provider_message_id", providerId)
                      .maybeSingle();
                    if (duplicateError) throw duplicateError;
                    if (duplicate) {
                      trace.database_insert_result = {
                        ok: true,
                        skipped_duplicate: true,
                        existing_message_id: duplicate.id,
                        conversation_id: duplicate.conversation_id,
                      };
                      console.info("WhatsApp inbound duplicate skipped:", JSON.stringify(trace));
                      await logWebhookEvent({ businessId, signatureOk: true, payload: trace });
                      continue;
                    }
                  }

                  // Media download: pull from Meta and persist to chat-media.
                  let mediaFields: Record<string, unknown> = {};
                  if (mediaKind && mediaNode?.id) {
                    try {
                      const stored = await downloadWhatsappMedia({
                        businessId,
                        mediaId: mediaNode.id,
                        contactId: contact.id,
                        kind: mediaKind === "sticker" ? "image" : mediaKind,
                        filename: mediaNode.filename ?? null,
                        mime: mediaNode.mime_type ?? null,
                      });
                      if (stored) mediaFields = stored;
                    } catch (mediaErr) {
                      trace.media_error = errorMessage(mediaErr);
                    }
                  }

                  const { data: inserted, error: insertError } = await supabaseAdmin
                    .from("messages")
                    .insert({
                      contact_id: contact.id,
                      conversation_id: conversation.id,
                      direction: "inbound",
                      content: text,
                      channel: "whatsapp",
                      provider_message_id: providerId,
                      created_at: m?.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString(),
                      ...mediaFields,
                    })
                    .select("id,conversation_id,created_at")
                    .single();

                  trace.database_insert_result = {
                    ok: !insertError,
                    message_id: inserted?.id ?? null,
                    conversation_id: inserted?.conversation_id ?? null,
                    created_at: inserted?.created_at ?? null,
                    error: insertError?.message ?? null,
                  };
                  if (insertError) throw insertError;

                  if (inserted.conversation_id) {
                    const { data: conversationAfter } = await supabaseAdmin
                      .from("conversations")
                      .select("id,last_message_at,last_message_preview,last_direction,unread_count")
                      .eq("id", inserted.conversation_id)
                      .maybeSingle();
                    trace.conversation_after_insert = conversationAfter ?? null;
                  } else {
                    trace.conversation_after_insert = null;
                    trace.error = "Message inserted without conversation_id";
                    console.warn("WhatsApp inbound inserted without conversation_id:", JSON.stringify(trace));
                  }

                  console.info("WhatsApp inbound stored:", JSON.stringify(trace));
                  await logWebhookEvent({ businessId, signatureOk: true, payload: trace });
                } catch (messageError) {
                  const message = errorMessage(messageError);
                  trace.error = message;
                  console.error("WhatsApp inbound message failed:", JSON.stringify(trace), messageError);
                  await logWebhookEvent({ businessId, signatureOk: true, payload: trace, error: message });
                }
              }
            }
          }
        } catch (err) {
          console.error("WhatsApp webhook error:", err);
          // Always 200 so Meta doesn't retry forever on our internal errors
        }

        return new Response("ok", { status: 200 });
      },

    },
  },
});
