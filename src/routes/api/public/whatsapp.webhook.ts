import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit.server";
import { maybeAutoReply } from "@/lib/ai-auto-reply.server";
import { decryptSecret } from "@/lib/crypto.server";

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

type BusinessMatch = {
  businessId: string;
  source:
    | "whatsapp_connections"
    | "whatsapp_connections_display_phone"
    | "channel_credentials"
    | "whatsapp_business_accounts"
    | "env";
};

type BusinessLookup = {
  matches: BusinessMatch[];
  phoneNumberId: string | null;
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

async function getBusinessWhatsappToken(businessId: string): Promise<string | null> {
  const { data: conn } = await supabaseAdmin
    .from("whatsapp_connections")
    .select("meta")
    .eq("business_id", businessId)
    .eq("status", "connected")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const meta = (conn?.meta ?? {}) as Record<string, unknown>;
  const fromConn =
    typeof meta.access_token === "string" ? await decryptSecret(meta.access_token) : null;
  if (fromConn) return fromConn;
  const { data: cred } = await supabaseAdmin
    .from("channel_credentials")
    .select("credentials")
    .eq("business_id", businessId)
    .eq("provider", "whatsapp")
    .eq("is_active", true)
    .maybeSingle();
  const c = (cred?.credentials ?? {}) as Record<string, string>;
  return (await decryptSecret(c.access_token)) ?? process.env.WHATSAPP_ACCESS_TOKEN ?? null;
}

async function downloadWhatsappMedia(opts: {
  businessId: string;
  mediaId: string;
  contactId: string;
  kind: "image" | "video" | "audio" | "document";
  filename: string | null;
  mime: string | null;
}): Promise<Record<string, unknown> | null> {
  const token = await getBusinessWhatsappToken(opts.businessId);
  if (!token) return null;
  const version = process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0";
  const metaRes = await fetch(`https://graph.facebook.com/${version}/${opts.mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`media meta ${metaRes.status}`);
  const metaJson = (await metaRes.json()) as { url?: string; mime_type?: string; file_size?: number };
  if (!metaJson.url) throw new Error("no media url");
  const fileRes = await fetch(metaJson.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!fileRes.ok) throw new Error(`media fetch ${fileRes.status}`);
  const buf = new Uint8Array(await fileRes.arrayBuffer());
  const mime = opts.mime ?? metaJson.mime_type ?? "application/octet-stream";
  const ext = mime.split("/")[1]?.split(";")[0] ?? "bin";
  const safeName = (opts.filename ?? `${opts.kind}-${Date.now()}.${ext}`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `inbound/${opts.businessId}/${opts.contactId}/${Date.now()}-${safeName}`;
  const { error: upErr } = await supabaseAdmin.storage
    .from("chat-media")
    .upload(path, buf, { contentType: mime, upsert: false });
  if (upErr) throw upErr;
  return {
    media_url: path,
    media_type: opts.kind,
    media_mime: mime,
    media_filename: opts.filename ?? null,
    media_size: metaJson.file_size ?? buf.byteLength,
  };
}

async function findBusinessesForPhoneNumberId(
  phoneNumberId: string | undefined,
  displayPhoneNumber?: string,
): Promise<BusinessLookup> {
  // Multi-tenant fan-out: the SAME WhatsApp number can be connected to
  // multiple businesses (e.g. a user configured it manually in Settings AND
  // used Embedded Signup, or shared the number across workspaces). We collect
  // every business_id that resolves for this phone_number_id and route the
  // inbound event to each one so the message appears in every inbox.
  const normalized = phoneNumberId?.trim() || null;
  const attempts: BusinessLookup["attempts"] = [];
  const displayDigits = phoneDigits(displayPhoneNumber);
  const seen = new Set<string>();
  const matches: BusinessMatch[] = [];
  const push = (businessId: string, source: BusinessMatch["source"]) => {
    if (!businessId || seen.has(businessId)) return;
    seen.add(businessId);
    matches.push({ businessId, source });
  };

  if (normalized) {
    const { data: conns } = await supabaseAdmin
      .from("whatsapp_connections")
      .select("id,business_id,status")
      .eq("phone_number_id", normalized)
      .neq("status", "disconnected");
    attempts.push({ source: "whatsapp_connections", count: conns?.length ?? 0 });
    for (const c of conns ?? []) push(c.business_id, "whatsapp_connections");

    const { data: accounts } = await supabaseAdmin
      .from("whatsapp_business_accounts")
      .select("business_id,status")
      .eq("phone_number_id", normalized);
    attempts.push({ source: "whatsapp_business_accounts", count: accounts?.length ?? 0 });
    for (const a of accounts ?? []) push(a.business_id, "whatsapp_business_accounts");
  }

  if (displayDigits) {
    const { data: displayRows } = await supabaseAdmin
      .from("whatsapp_connections")
      .select("id,business_id,status,phone_number,phone_number_id")
      .neq("status", "disconnected")
      .limit(500);
    for (const row of displayRows ?? []) {
      if (phoneDigits(row.phone_number) === displayDigits) {
        push(row.business_id, "whatsapp_connections_display_phone");
        await maybeBackfillConnectionPhoneId(row.id, normalized ?? undefined);
      }
    }
  }

  const { data: credentialRows } = await supabaseAdmin
    .from("channel_credentials")
    .select("business_id,credentials,is_active")
    .eq("provider", "whatsapp")
    .eq("is_active", true);
  for (const row of credentialRows ?? []) {
    const credentials = (row.credentials ?? {}) as Record<string, string>;
    const credPnId = String(credentials.phone_number_id ?? "").trim();
    const credDisplay = phoneDigits(credentials.phone_number ?? credentials.display_phone_number);
    if ((normalized && credPnId === normalized) || (displayDigits && credDisplay === displayDigits)) {
      push(row.business_id, "channel_credentials");
    }
  }

  const envPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const envBusinessId = process.env.WHATSAPP_DEFAULT_BUSINESS_ID?.trim();
  if (envPhoneNumberId && envBusinessId && normalized && envPhoneNumberId === normalized) {
    push(envBusinessId, "env");
  }

  attempts.push({ source: "final", matched_count: matches.length });
  return { matches, phoneNumberId: normalized, attempts };
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
          console.log("[WA webhook] POST received", {
            entry_count: entries.length,
            object: payload?.object ?? null,
          });
          for (const entry of entries) {
            for (const change of entry?.changes ?? []) {
              const value = change?.value ?? {};
              const phoneNumberId: string | undefined = value?.metadata?.phone_number_id;
              const displayPhoneNumber: string | undefined = value?.metadata?.display_phone_number;
              const businessLookup = await findBusinessesForPhoneNumberId(phoneNumberId, displayPhoneNumber);
              const businessIds = businessLookup.matches.map((m) => m.businessId);
              console.log("[WA webhook] change", {
                field: change?.field ?? null,
                phone_number_id: phoneNumberId ?? null,
                display_phone_number: displayPhoneNumber ?? null,
                matched_business_count: businessIds.length,
                matched_business_ids: businessIds,
                messages_in_change: (value?.messages ?? []).length,
              });

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
                console.log("[WA inbound]", {
                  phone_number_id: phoneNumberId ?? null,
                  from,
                  type: m?.type ?? null,
                  provider_message_id: m?.id ?? null,
                  matched_business_ids: businessIds,
                });
                const phone = whatsappPhone(from);

                // Reaction messages update the target message's reactions
                // instead of inserting a new row in the transcript.
                if (m?.type === "reaction" && m?.reaction?.message_id) {
                  const targetProviderId: string = m.reaction.message_id;
                  const emoji: string = m.reaction.emoji ?? "";
                  for (const businessId of businessIds) {
                    try {
                      const { data: target } = await supabaseAdmin
                        .from("messages")
                        .select("id,reactions,contact_id")
                        .eq("provider_message_id", targetProviderId)
                        .maybeSingle();
                      if (!target) continue;
                      const list = Array.isArray(target.reactions) ? (target.reactions as unknown as Array<{ emoji: string; direction: string; at: string }>) : [];
                      const withoutTheirs = list.filter((r) => r.direction !== "inbound");
                      const next = emoji
                        ? [...withoutTheirs, { emoji, direction: "inbound", at: new Date().toISOString() }]
                        : withoutTheirs;
                      await supabaseAdmin.from("messages").update({ reactions: next as never }).eq("id", target.id);
                    } catch (rxErr) {
                      console.error("[WA webhook] reaction update failed", rxErr, { businessId });
                    }
                  }
                  continue;
                }

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

                if (businessIds.length === 0) {
                  const trace: Record<string, unknown> = {
                    event: "inbound_message",
                    phone_number_id: phoneNumberId ?? null,
                    display_phone_number: displayPhoneNumber ?? null,
                    sender_number: phone,
                    message_text: text,
                    provider_message_id: providerId,
                    business_lookup: businessLookup,
                    error: `No business matched phone_number_id ${phoneNumberId ?? "<missing>"}`,
                  };
                  console.warn("WhatsApp inbound routing failed:", JSON.stringify(trace));
                  await logWebhookEvent({
                    businessId: null,
                    signatureOk: true,
                    payload: trace,
                    error: String(trace.error),
                  });
                  continue;
                }

                // Fan out to every business that owns this phone_number_id.
                for (const businessId of businessIds) {
                  const trace: Record<string, unknown> = {
                    event: "inbound_message",
                    phone_number_id: phoneNumberId ?? null,
                    display_phone_number: displayPhoneNumber ?? null,
                    sender_number: phone,
                    message_text: text,
                    provider_message_id: providerId,
                    business_lookup: businessLookup,
                    fanout_business_id: businessId,
                    fanout_total: businessIds.length,
                    contact_result: null,
                    conversation_lookup_result: null,
                    database_insert_result: null,
                    error: null,
                  };

                  try {
                    const contact = await upsertContact(
                      businessId,
                      phone,
                      nameByWaId.get(from) ?? null,
                    );
                    trace.contact_result = contact;

                    const { conversation, created: conversationCreated } = await getOrCreateConversation(businessId, contact.id);
                    trace.conversation_lookup_result = {
                      conversation_id: conversation?.id ?? null,
                      business_id: conversation?.business_id ?? null,
                      created: conversationCreated,
                    };

                    if (providerId) {
                      // Dedup scoped per-contact (unique index (contact_id, provider_message_id)).
                      const { data: duplicate } = await supabaseAdmin
                        .from("messages")
                        .select("id,conversation_id")
                        .eq("contact_id", contact.id)
                        .eq("provider_message_id", providerId)
                        .maybeSingle();
                      if (duplicate) {
                        trace.database_insert_result = {
                          ok: true, skipped_duplicate: true,
                          existing_message_id: duplicate.id,
                          conversation_id: duplicate.conversation_id,
                        };
                        await logWebhookEvent({ businessId, signatureOk: true, payload: trace });
                        continue;
                      }
                    }

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
                      error: insertError?.message ?? null,
                    };
                    if (insertError) throw insertError;

                    await logWebhookEvent({ businessId, signatureOk: true, payload: trace });

                    // Fire AI auto-reply (no-op if disabled for this business).
                    try {
                      await maybeAutoReply({
                        businessId,
                        contactId: contact.id,
                        conversationId: conversation.id,
                        toPhone: phone,
                      });
                    } catch (aiErr) {
                      console.error("[WA webhook] AI reply failed", aiErr);
                    }
                  } catch (messageError) {
                    const message = errorMessage(messageError);
                    trace.error = message;
                    console.error("WhatsApp inbound message failed:", JSON.stringify(trace), messageError);
                    await logWebhookEvent({ businessId, signatureOk: true, payload: trace, error: message });
                  }
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
