-- Hot-path indexes
CREATE INDEX IF NOT EXISTS idx_messages_contact_created ON public.messages (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON public.messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_provider_message_id ON public.messages (provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_business_last_message ON public.conversations (business_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_business_status ON public.conversations (business_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_assigned_to ON public.conversations (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_business_score ON public.contacts (business_id, lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_business_phone ON public.contacts (business_id, phone);
CREATE INDEX IF NOT EXISTS idx_sms_logs_business_created ON public.sms_logs (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_business_created ON public.webhook_logs (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_score_history_contact_created ON public.lead_score_history (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revenue_entries_business_occurred ON public.revenue_entries (business_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_routing_action_runs_pending ON public.routing_action_runs (status, scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON public.rate_limits (window_start);

-- Audit log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  target_type text,
  target_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their business audit log"
  ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

CREATE INDEX IF NOT EXISTS idx_audit_log_business_created ON public.audit_log (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.audit_log (business_id, action, created_at DESC);