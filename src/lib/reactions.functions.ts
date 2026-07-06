import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ReactionEntry = { emoji: string; direction: "inbound" | "outbound"; at: string };

async function resolveWhatsAppSend(businessId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: conn } = await supabaseAdmin
    .from("whatsapp_connections")
    .select("phone_number_id,meta")
    .eq("business_id", businessId)
    .eq("status", "connected")
    .not("phone_number_id", "is", null)
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const meta = (conn?.meta ?? {}) as Record<string, string>;
  let token = meta.access_token as string | undefined;
  let phoneNumberId = conn?.phone_number_id as string | null;
  if (!token || !phoneNumberId) {
    const { data: cred } = await supabaseAdmin
      .from("channel_credentials")
      .select("credentials,is_active")
      .eq("business_id", businessId)
      .eq("provider", "whatsapp")
      .maybeSingle();
    const c = (cred?.credentials ?? {}) as Record<string, string>;
    token = token ?? c.access_token ?? process.env.WHATSAPP_ACCESS_TOKEN;
    phoneNumberId = phoneNumberId ?? c.phone_number_id ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? null;
  }
  if (!token || !phoneNumberId) throw new Error("WhatsApp not configured");
  return { token, phoneNumberId };
}

/**
 * React to (or clear the reaction on) a WhatsApp message. Passing an empty
 * emoji clears the current outbound reaction, matching Meta's semantics.
 */
export const reactToMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        messageId: z.string().uuid(),
        emoji: z.string().max(16),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: msg, error: msgErr } = await supabase
      .from("messages")
      .select("id,contact_id,provider_message_id,reactions,channel")
      .eq("id", data.messageId)
      .single();
    if (msgErr || !msg) throw new Error("Message not found");

    const { data: contact, error: contactErr } = await supabase
      .from("contacts")
      .select("id,phone,business_id")
      .eq("id", msg.contact_id)
      .single();
    if (contactErr || !contact) throw new Error("Contact not found");

    // Only send to Meta if we actually have a provider id and the channel is WhatsApp.
    if (msg.channel === "whatsapp" && msg.provider_message_id) {
      const { token, phoneNumberId } = await resolveWhatsAppSend(contact.business_id);
      const to = contact.phone.replace(/^\+/, "");
      const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "reaction",
          reaction: { message_id: msg.provider_message_id, emoji: data.emoji },
        }),
      });
      if (!res.ok) throw new Error(`WhatsApp reaction ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }

    // Update local reactions: keep only one "outbound" reaction at a time.
    const existing: ReactionEntry[] = Array.isArray(msg.reactions)
      ? (msg.reactions as unknown as ReactionEntry[])
      : [];
    const withoutOwn = existing.filter((r) => r.direction !== "outbound");
    const next = data.emoji
      ? [...withoutOwn, { emoji: data.emoji, direction: "outbound" as const, at: new Date().toISOString() }]
      : withoutOwn;

    const { error: updErr } = await supabase
      .from("messages")
      .update({ reactions: next as never })
      .eq("id", msg.id);
    if (updErr) throw new Error(updErr.message);
    return { ok: true, reactions: next };
  });
