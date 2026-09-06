CREATE TABLE public.ai_reply_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  conversation_id uuid,
  message_id uuid,
  to_phone text NOT NULL,
  inbound_content text,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  error text,
  locked_at timestamptz,
  run_after timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ai_reply_jobs_message_uniq ON public.ai_reply_jobs (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX ai_reply_jobs_pending_idx ON public.ai_reply_jobs (status, run_after, created_at);
CREATE INDEX ai_reply_jobs_conv_idx ON public.ai_reply_jobs (contact_id, status);

GRANT ALL ON public.ai_reply_jobs TO service_role;

ALTER TABLE public.ai_reply_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages ai reply jobs"
ON public.ai_reply_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_ai_reply_jobs_updated_at
BEFORE UPDATE ON public.ai_reply_jobs
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();