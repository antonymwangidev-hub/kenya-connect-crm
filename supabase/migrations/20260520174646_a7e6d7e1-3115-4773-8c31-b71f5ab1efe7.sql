-- Fix permission denied: allow authenticated users to execute the RLS helper functions
GRANT EXECUTE ON FUNCTION public.owns_business(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.owns_contact(uuid) TO authenticated, anon;

-- Add channel column to messages
DO $$ BEGIN
  CREATE TYPE public.message_channel AS ENUM ('manual', 'whatsapp', 'sms');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS channel public.message_channel NOT NULL DEFAULT 'manual';

-- Unique (business_id, phone) for auto-linking
CREATE UNIQUE INDEX IF NOT EXISTS contacts_business_phone_unique
  ON public.contacts (business_id, phone);

-- SMS logs table
CREATE TABLE IF NOT EXISTS public.sms_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  contact_id uuid,
  phone text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error text,
  provider_sid text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read sms_logs in own business" ON public.sms_logs
  FOR SELECT USING (public.owns_business(business_id));
CREATE POLICY "insert sms_logs in own business" ON public.sms_logs
  FOR INSERT WITH CHECK (public.owns_business(business_id));
CREATE POLICY "delete sms_logs in own business" ON public.sms_logs
  FOR DELETE USING (public.owns_business(business_id));
