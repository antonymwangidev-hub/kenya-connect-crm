import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsApp, sendAfricasTalking } from "@/lib/messaging.functions";

/**
 * Processes queued routing actions (currently outbound messages).
 * Idempotent: rows are claimed by flipping status from `pending` to `sending`
 * before any external call, so a duplicate run cannot double-send.
 */
export async function processRoutingQueue(opts: { businessId?: string; limit?: number } = {}) {
  const limit = Math.min(opts.limit ?? 50, 200);
  let q = supabaseAdmin
    .from("routing_action_runs")
    .select("id,business_id,contact_id,action,payload")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (opts.businessId) q = q.eq("business_id", opts.businessId);

  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);

  let sent = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    // claim
    const { data: claimed } = await supabaseAdmin
      .from("routing_action_runs")
      .update({ status: "sending" })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const body = String((row.payload as Record<string, unknown> | null)?.["body"] ?? "").trim();
    if (row.action !== "send_message" || !body) {
      await supabaseAdmin
        .from("routing_action_runs")
        .update({ status: "skipped", detail: "nothing to send", processed_at: new Date().toISOString() })
        .eq("id", row.id);
      continue;
    }

    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("id,name,phone")
      .eq("id", row.contact_id)
      .maybeSingle();

    if (!contact) {
      await supabaseAdmin
        .from("routing_action_runs")
        .update({ status: "failed", detail: "contact not found", processed_at: new Date().toISOString() })
        .eq("id", row.id);
      failed++;
      continue;
    }

    const text = body.replace(/\{\{\s*name\s*\}\}/gi, contact.name ?? "");
    let channel: "whatsapp" | "sms" = "whatsapp";
    try {
      try {
        await sendWhatsApp(row.business_id, contact.phone, text);
      } catch {
        await sendAfricasTalking(row.business_id, contact.phone, text);
        channel = "sms";
      }
      await supabaseAdmin.from("messages").insert({
        contact_id: contact.id,
        direction: "outbound",
        content: text,
        channel,
      });
      await supabaseAdmin
        .from("routing_action_runs")
        .update({ status: "done", detail: `sent via ${channel}`, processed_at: new Date().toISOString() })
        .eq("id", row.id);
      sent++;
    } catch (e) {
      await supabaseAdmin
        .from("routing_action_runs")
        .update({
          status: "failed",
          detail: e instanceof Error ? e.message.slice(0, 500) : "send failed",
          processed_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      failed++;
    }
  }

  return { processed: (rows ?? []).length, sent, failed };
}
