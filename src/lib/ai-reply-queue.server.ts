import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateAndSendAiReply } from "@/lib/ai-auto-reply.server";

/**
 * Durable AI auto-reply queue.
 *
 * Every inbound message is enqueued as its own job (unique per message id), so
 * bursts of messages can never lose a reply. Jobs for the same contact are
 * processed strictly one at a time and in arrival order, which keeps the
 * conversation coherent and prevents concurrent webhook invocations from
 * racing each other.
 */

const MAX_ATTEMPTS = 3;
const LEASE_MS = 3 * 60 * 1000; // a job stuck "processing" this long is retried

export type EnqueueOpts = {
  businessId: string;
  contactId: string;
  conversationId: string | null;
  messageId: string | null;
  toPhone: string;
  content: string | null;
};

export async function enqueueAiReply(opts: EnqueueOpts) {
  const { error } = await supabaseAdmin.from("ai_reply_jobs").insert({
    business_id: opts.businessId,
    contact_id: opts.contactId,
    conversation_id: opts.conversationId,
    message_id: opts.messageId,
    to_phone: opts.toPhone,
    inbound_content: opts.content,
    status: "pending",
  });
  // Duplicate message_id => already queued; that is the desired no-op.
  if (error && !/duplicate key|unique/i.test(error.message)) {
    console.error("[AI queue] enqueue failed", error.message);
  }
}

/** Release jobs whose worker died mid-flight. */
async function reclaimStale() {
  const cutoff = new Date(Date.now() - LEASE_MS).toISOString();
  await supabaseAdmin
    .from("ai_reply_jobs")
    .update({ status: "pending", locked_at: null })
    .eq("status", "processing")
    .lt("locked_at", cutoff);
}

async function claim(jobId: string) {
  const { data } = await supabaseAdmin
    .from("ai_reply_jobs")
    .update({ status: "processing", locked_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "pending")
    .select("id,business_id,contact_id,conversation_id,to_phone,inbound_content,attempts")
    .maybeSingle();
  return data;
}

/**
 * Process pending reply jobs. Bounded per run; safe to call concurrently —
 * jobs are claimed atomically and a contact already being processed is skipped
 * so replies stay in order.
 */
export async function processAiReplyQueue(opts: { businessId?: string; contactId?: string; limit?: number } = {}) {
  const limit = Math.min(opts.limit ?? 10, 50);
  await reclaimStale();

  let q = supabaseAdmin
    .from("ai_reply_jobs")
    .select("id,business_id,contact_id,conversation_id,to_phone,inbound_content,attempts")
    .eq("status", "pending")
    .lte("run_after", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);
  if (opts.businessId) q = q.eq("business_id", opts.businessId);
  if (opts.contactId) q = q.eq("contact_id", opts.contactId);

  const { data: rows, error } = await q;
  if (error) {
    console.error("[AI queue] list failed", error.message);
    return { processed: 0, sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  let processed = 0;
  const busyContacts = new Set<string>();

  for (const row of rows ?? []) {
    if (busyContacts.has(row.contact_id)) continue; // keep per-contact ordering

    // Another worker may already be replying to this contact.
    const { data: inFlight } = await supabaseAdmin
      .from("ai_reply_jobs")
      .select("id")
      .eq("contact_id", row.contact_id)
      .eq("status", "processing")
      .limit(1)
      .maybeSingle();
    if (inFlight) continue;

    const job = await claim(row.id);
    if (!job) continue;
    busyContacts.add(job.contact_id);
    processed++;

    try {
      const result = await generateAndSendAiReply({
        businessId: job.business_id,
        contactId: job.contact_id,
        conversationId: job.conversation_id,
        toPhone: job.to_phone,
        inboundContent: job.inbound_content,
      });
      await supabaseAdmin
        .from("ai_reply_jobs")
        .update({
          status: result.sent ? "done" : "skipped",
          detail: null,
          error: result.sent ? null : result.reason,
          processed_at: new Date().toISOString(),
          attempts: job.attempts + 1,
          locked_at: null,
        } as never)
        .eq("id", job.id);
      if (result.sent) sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = job.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await supabaseAdmin
        .from("ai_reply_jobs")
        .update({
          status: giveUp ? "failed" : "pending",
          attempts,
          error: message.slice(0, 500),
          locked_at: null,
          run_after: new Date(Date.now() + attempts * 30_000).toISOString(),
          ...(giveUp ? { processed_at: new Date().toISOString() } : {}),
        })
        .eq("id", job.id);
      failed++;
      console.error("[AI queue] job failed", { jobId: job.id, attempts, message });
    }
  }

  return { processed, sent, failed };
}
