
CREATE TABLE IF NOT EXISTS public.gateway_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL UNIQUE REFERENCES public.businesses(id) ON DELETE CASCADE,
  base_url text NOT NULL,
  api_key text NOT NULL,
  webhook_secret text,
  webhook_url text,
  webhook_registered_at timestamptz,
  business_name text,
  whatsapp_connected boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Secrets live here: only server-side (service_role) code may read this table.
GRANT ALL ON public.gateway_settings TO service_role;
ALTER TABLE public.gateway_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.gateway_unmatched_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  phone text NOT NULL,
  channel text,
  body text,
  provider_message_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
GRANT SELECT, UPDATE, DELETE ON public.gateway_unmatched_messages TO authenticated;
GRANT ALL ON public.gateway_unmatched_messages TO service_role;
ALTER TABLE public.gateway_unmatched_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read unmatched" ON public.gateway_unmatched_messages
  FOR SELECT TO authenticated USING (public.is_business_member(business_id));
CREATE POLICY "members update unmatched" ON public.gateway_unmatched_messages
  FOR UPDATE TO authenticated USING (public.is_business_member(business_id));
CREATE POLICY "members delete unmatched" ON public.gateway_unmatched_messages
  FOR DELETE TO authenticated USING (public.is_business_member(business_id));

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opt_in_source text,
  ADD COLUMN IF NOT EXISTS gateway_synced_at timestamptz;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS messaging_provider text NOT NULL DEFAULT 'meta';

DO $$ BEGIN
  ALTER TABLE public.businesses
    ADD CONSTRAINT businesses_messaging_provider_check
    CHECK (messaging_provider IN ('meta','gateway'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_gateway_unmatched_business ON public.gateway_unmatched_messages(business_id, received_at DESC);
