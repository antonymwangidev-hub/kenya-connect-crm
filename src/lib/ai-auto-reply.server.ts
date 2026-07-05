import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsApp } from "@/lib/messaging.functions";

type AiRow = {
  enabled: boolean;
  business_description: string | null;
  products_services: string | null;
  contact_info: string | null;
  address: string | null;
  website: string | null;
  hours: string | null;
  faqs: string | null;
  tone: string | null;
  custom_instructions: string | null;
};

function buildSystemPrompt(businessName: string, s: AiRow) {
  const tone = s.tone || "friendly";
  const parts: string[] = [
    `You are the AI customer support assistant for "${businessName}". You chat with customers on WhatsApp on behalf of the business.`,
    `Tone: ${tone}. Reply in the same language the customer used. Keep replies short (1-3 sentences, under 500 characters), natural, and free of markdown.`,
    `Only answer using the BUSINESS INFORMATION below. If the customer asks something you cannot answer from it, say you'll have a team member follow up shortly — never invent facts, prices, or policies.`,
    "",
    "=== BUSINESS INFORMATION ===",
    s.business_description ? `About: ${s.business_description}` : "",
    s.products_services ? `Products & services:\n${s.products_services}` : "",
    s.contact_info ? `Contact: ${s.contact_info}` : "",
    s.address ? `Address: ${s.address}` : "",
    s.website ? `Website: ${s.website}` : "",
    s.hours ? `Hours: ${s.hours}` : "",
    s.faqs ? `FAQs:\n${s.faqs}` : "",
    s.custom_instructions ? `\nExtra instructions from the business owner:\n${s.custom_instructions}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

async function callLovableAI(system: string, history: { role: "user" | "assistant"; content: string }[]) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "system", content: system }, ...history],
    }),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (j.choices?.[0]?.message?.content ?? "").trim();
}

export async function maybeAutoReply(opts: {
  businessId: string;
  contactId: string;
  conversationId: string;
  toPhone: string;
}) {
  try {
    const { data: settings } = await supabaseAdmin
      .from("ai_assistant_settings")
      .select("*")
      .eq("business_id", opts.businessId)
      .maybeSingle();
    if (!settings || !settings.enabled) {
      console.log("[AI reply] skipped (disabled)", { businessId: opts.businessId });
      return;
    }

    const { data: biz } = await supabaseAdmin
      .from("businesses").select("name").eq("id", opts.businessId).maybeSingle();

    const { data: msgs } = await supabaseAdmin
      .from("messages")
      .select("direction,content,created_at")
      .eq("contact_id", opts.contactId)
      .order("created_at", { ascending: false })
      .limit(12);

    const history = (msgs ?? [])
      .reverse()
      .filter((m) => (m.content ?? "").trim().length > 0)
      .map((m) => ({
        role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      }));
    if (history.length === 0 || history[history.length - 1].role !== "user") {
      console.log("[AI reply] skipped (no inbound tail)", { contactId: opts.contactId });
      return;
    }

    const system = buildSystemPrompt(biz?.name ?? "the business", settings as AiRow);
    const reply = await callLovableAI(system, history);
    if (!reply) {
      console.log("[AI reply] empty response");
      return;
    }

    await sendWhatsApp(opts.businessId, opts.toPhone, reply);

    const { error: insErr } = await supabaseAdmin.from("messages").insert({
      contact_id: opts.contactId,
      conversation_id: opts.conversationId,
      direction: "outbound",
      content: reply,
      channel: "whatsapp",
    });
    if (insErr) console.warn("[AI reply] insert failed", insErr.message);
    else console.log("[AI reply] sent", { businessId: opts.businessId, contactId: opts.contactId, len: reply.length });
  } catch (err) {
    console.error("[AI reply] failed", err instanceof Error ? err.message : err);
  }
}
