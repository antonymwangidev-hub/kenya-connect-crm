import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendWhatsApp, sendAfricasTalking } from "@/lib/messaging.functions";


// ---- Broadcast: send the same message to many contacts, with a small delay between sends ----
export const sendBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().trim().min(1).max(120),
        content: z.string().trim().min(1).max(4000),
        contactIds: z.array(z.string().uuid()).min(1).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Resolve business id from contacts (RLS already scopes them)
    const { data: contacts, error: cErr } = await supabase
      .from("contacts")
      .select("id,business_id,phone")
      .in("id", data.contactIds);
    if (cErr) throw new Error(cErr.message);
    if (!contacts || contacts.length === 0) throw new Error("No contacts found");

    const businessId = contacts[0].business_id;

    const { data: broadcast, error: bErr } = await supabase
      .from("broadcasts")
      .insert({
        business_id: businessId,
        name: data.name,
        content: data.content,
        total_recipients: contacts.length,
      })
      .select()
      .single();
    if (bErr || !broadcast) throw new Error(bErr?.message ?? "Failed to create broadcast");

    let sent = 0;
    let failed = 0;

    // Rate-limit: ~3 messages/sec
    for (const c of contacts) {
      let channel: "whatsapp" | "sms" | "manual" = "manual";
      let err: string | null = null;
      try {
        try {
          await sendWhatsApp(businessId, c.phone, data.content);
          channel = "whatsapp";
        } catch (waErr) {
          // Fallback to SMS via Africa's Talking
          await sendAfricasTalking(businessId, c.phone, data.content);
          channel = "sms";
        }
        await supabase.from("messages").insert({
          contact_id: c.id,
          direction: "outbound",
          content: data.content,
          channel,
        });
        await supabase.from("broadcast_recipients").insert({
          broadcast_id: broadcast.id,
          contact_id: c.id,
          status: "sent",
          channel,
          sent_at: new Date().toISOString(),
        });
        sent++;
      } catch (e) {
        err = e instanceof Error ? e.message : "send failed";
        failed++;
        await supabase.from("broadcast_recipients").insert({
          broadcast_id: broadcast.id,
          contact_id: c.id,
          status: "failed",
          error: err,
        });
      }
      await new Promise((r) => setTimeout(r, 300));
    }



    await supabase
      .from("broadcasts")
      .update({ sent_count: sent, failed_count: failed })
      .eq("id", broadcast.id);

    return { broadcastId: broadcast.id, sent, failed };
  });

// ---- AI: generate follow-up suggestion using the Lovable AI gateway ----
export const suggestFollowUp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        contactId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI not configured");

    const { data: contact } = await supabase
      .from("contacts")
      .select("name,stage")
      .eq("id", data.contactId)
      .single();
    if (!contact) throw new Error("Contact not found");

    const { data: msgs } = await supabase
      .from("messages")
      .select("direction,content,created_at")
      .eq("contact_id", data.contactId)
      .order("created_at", { ascending: false })
      .limit(8);

    const transcript = (msgs ?? [])
      .reverse()
      .map((m) => `${m.direction === "inbound" ? "Customer" : "Me"}: ${m.content}`)
      .join("\n");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are a sales assistant for a small business in Kenya. Write short, friendly WhatsApp follow-up messages (max 2 sentences). Use simple English. No emojis unless natural. Reply with the message only.",
          },
          {
            role: "user",
            content: `Contact: ${contact.name} (stage: ${contact.stage}).\nRecent conversation:\n${transcript || "(no messages yet)"}\n\nWrite a follow-up message.`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`AI ${res.status}: ${body}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const suggestion = json.choices?.[0]?.message?.content?.trim() ?? "";
    return { suggestion };
  });
