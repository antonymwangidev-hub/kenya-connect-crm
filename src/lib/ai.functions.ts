import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TONES = ["polite", "sales", "urgent"] as const;
type Tone = (typeof TONES)[number];

async function callAI(messages: { role: string; content: string }[]) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("AI not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-2.5-flash", messages }),
  });
  if (res.status === 429) throw new Error("AI rate limit reached. Try again shortly.");
  if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace settings.");
  if (!res.ok) throw new Error(`AI ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

function toneInstruction(tone: Tone) {
  switch (tone) {
    case "polite":
      return "Use a warm, polite, respectful tone. No pressure.";
    case "sales":
      return "Use a confident, persuasive sales tone that highlights value. Include a soft call to action.";
    case "urgent":
      return "Use a clear, urgent tone. Encourage immediate action without being rude.";
  }
}

// ---- Suggest a reply with tone control ----
export const suggestReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ contactId: z.string().uuid(), tone: z.enum(TONES).default("polite") }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
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
      .limit(10);

    const transcript = (msgs ?? [])
      .reverse()
      .map((m) => `${m.direction === "inbound" ? "Customer" : "Me"}: ${m.content}`)
      .join("\n");

    const suggestion = await callAI([
      {
        role: "system",
        content: `You are a WhatsApp sales assistant for a small business in Kenya. Write a short reply (1-2 sentences, max 220 chars), simple English, no markdown. ${toneInstruction(data.tone)} Reply with the message only.`,
      },
      {
        role: "user",
        content: `Contact: ${contact.name} (stage: ${contact.stage}).\nConversation:\n${transcript || "(no messages yet)"}\n\nWrite the next message.`,
      },
    ]);
    return { suggestion };
  });

// ---- Smart insights: hot leads, inactive leads, template suggestion ----
export const generateInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ businessId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: contacts } = await supabase
      .from("contacts")
      .select("id,name,phone,stage,created_at")
      .eq("business_id", data.businessId);

    const { data: recentMsgs } = await supabase
      .from("messages")
      .select("contact_id,direction,content,created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    const now = Date.now();
    const byContact = new Map<string, { last: number; inbound: number; outbound: number; lastInbound: number }>();
    for (const m of recentMsgs ?? []) {
      const t = new Date(m.created_at).getTime();
      const e = byContact.get(m.contact_id) ?? { last: 0, inbound: 0, outbound: 0, lastInbound: 0 };
      e.last = Math.max(e.last, t);
      if (m.direction === "inbound") {
        e.inbound++;
        e.lastInbound = Math.max(e.lastInbound, t);
      } else e.outbound++;
      byContact.set(m.contact_id, e);
    }

    const hot: { id: string; name: string; reason: string }[] = [];
    const inactive: { id: string; name: string; days: number }[] = [];

    for (const c of contacts ?? []) {
      const e = byContact.get(c.id);
      if (!e) continue;
      const daysSince = Math.floor((now - e.last) / (1000 * 60 * 60 * 24));
      if (e.inbound >= 2 && daysSince <= 2 && (c.stage === "interested" || c.stage === "negotiation" || c.stage === "new")) {
        hot.push({ id: c.id, name: c.name, reason: `${e.inbound} recent replies` });
      }
      if (daysSince >= 5 && c.stage !== "paid" && c.stage !== "lost") {
        inactive.push({ id: c.id, name: c.name, days: daysSince });
      }
    }

    hot.sort((a, b) => b.reason.localeCompare(a.reason));
    inactive.sort((a, b) => b.days - a.days);

    return {
      hot: hot.slice(0, 10),
      inactive: inactive.slice(0, 10),
      totals: { contacts: contacts?.length ?? 0, messages: recentMsgs?.length ?? 0 },
    };
  });

// ---- Customer segmentation using AI on aggregate signals ----
export const segmentContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ businessId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id,name,stage,created_at")
      .eq("business_id", data.businessId)
      .limit(100);

    const { data: msgs } = await supabase
      .from("messages")
      .select("contact_id,direction,created_at")
      .order("created_at", { ascending: false })
      .limit(1000);

    const stats = (contacts ?? []).map((c) => {
      const ms = (msgs ?? []).filter((m) => m.contact_id === c.id);
      const inbound = ms.filter((m) => m.direction === "inbound").length;
      const outbound = ms.filter((m) => m.direction === "outbound").length;
      const last = ms[0] ? new Date(ms[0].created_at).getTime() : 0;
      const days = last ? Math.floor((Date.now() - last) / 86400000) : 999;
      return { name: c.name, stage: c.stage, inbound, outbound, daysSinceLast: days };
    });

    const summary = await callAI([
      {
        role: "system",
        content:
          "You segment small-business CRM contacts. Return concise plain text with 3-5 segments. For each: a short label, count, and 1-line description and recommended action. No markdown.",
      },
      { role: "user", content: `Data (JSON):\n${JSON.stringify(stats).slice(0, 6000)}` },
    ]);

    return { summary, count: stats.length };
  });

// ---- WhatsApp template optimization: suggest best-performing templates from history ----
export const optimizeTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ businessId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Get business contacts then their outbound messages and whether they got a reply
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id")
      .eq("business_id", data.businessId);
    const ids = (contacts ?? []).map((c) => c.id);
    if (ids.length === 0) return { templates: [] as { text: string; sent: number; replyRate: number }[] };

    const { data: msgs } = await supabase
      .from("messages")
      .select("contact_id,direction,content,created_at")
      .in("contact_id", ids)
      .order("created_at", { ascending: true })
      .limit(2000);

    // Score outbound messages by whether contact replied within 48h
    const buckets = new Map<string, { sent: number; replied: number }>();
    const all = msgs ?? [];
    for (let i = 0; i < all.length; i++) {
      const m = all[i];
      if (m.direction !== "outbound") continue;
      const sig = m.content.trim().slice(0, 80).toLowerCase();
      const bucket = buckets.get(sig) ?? { sent: 0, replied: 0 };
      bucket.sent++;
      const sentAt = new Date(m.created_at).getTime();
      const replied = all.some(
        (x) =>
          x.contact_id === m.contact_id &&
          x.direction === "inbound" &&
          new Date(x.created_at).getTime() > sentAt &&
          new Date(x.created_at).getTime() - sentAt < 48 * 3600 * 1000,
      );
      if (replied) bucket.replied++;
      buckets.set(sig, bucket);
    }

    const templates = [...buckets.entries()]
      .filter(([, v]) => v.sent >= 2)
      .map(([text, v]) => ({ text, sent: v.sent, replyRate: v.replied / v.sent }))
      .sort((a, b) => b.replyRate - a.replyRate || b.sent - a.sent)
      .slice(0, 8);

    return { templates };
  });
