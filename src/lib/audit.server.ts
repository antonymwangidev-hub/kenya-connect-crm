import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AuditEntry = {
  businessId: string;
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown>;
};

/**
 * Append-only audit trail for sensitive operations (message sends, credential
 * changes, team/role changes, automation edits). Never throws: auditing must not
 * break the operation it records.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("audit_log").insert({
      business_id: entry.businessId,
      actor_id: entry.actorId ?? null,
      actor_email: entry.actorEmail ?? null,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      detail: (entry.detail ?? {}) as never,
    });
    if (error) console.warn("audit_log insert failed:", error.message);
  } catch (e) {
    console.warn("audit_log insert threw", e instanceof Error ? e.message : e);
  }
}
