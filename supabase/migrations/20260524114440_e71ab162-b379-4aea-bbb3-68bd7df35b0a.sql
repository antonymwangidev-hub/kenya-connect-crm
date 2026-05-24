
-- businesses extra fields
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS mpesa_number text,
  ADD COLUMN IF NOT EXISTS mpesa_type text CHECK (mpesa_type IN ('paybill','till','phone')),
  ADD COLUMN IF NOT EXISTS default_greeting text,
  ADD COLUMN IF NOT EXISTS business_hours jsonb DEFAULT '{"mon":{"open":"09:00","close":"17:00","closed":false},"tue":{"open":"09:00","close":"17:00","closed":false},"wed":{"open":"09:00","close":"17:00","closed":false},"thu":{"open":"09:00","close":"17:00","closed":false},"fri":{"open":"09:00","close":"17:00","closed":false},"sat":{"open":"09:00","close":"13:00","closed":false},"sun":{"open":"09:00","close":"13:00","closed":true}}'::jsonb,
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

-- channel credentials
CREATE TABLE IF NOT EXISTS public.channel_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('whatsapp','africastalking','mpesa')),
  credentials jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, provider)
);
ALTER TABLE public.channel_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read channel_credentials in own business" ON public.channel_credentials FOR SELECT USING (public.owns_business(business_id));
CREATE POLICY "insert channel_credentials in own business" ON public.channel_credentials FOR INSERT WITH CHECK (public.owns_business(business_id));
CREATE POLICY "update channel_credentials in own business" ON public.channel_credentials FOR UPDATE USING (public.owns_business(business_id));
CREATE POLICY "delete channel_credentials in own business" ON public.channel_credentials FOR DELETE USING (public.owns_business(business_id));

-- conversations extra fields
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS assigned_to uuid,
  ADD COLUMN IF NOT EXISTS team text CHECK (team IN ('sales','support','general')) DEFAULT 'general';

-- conversation notes
CREATE TABLE IF NOT EXISTS public.conversation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  business_id uuid NOT NULL,
  author_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conversation_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read notes in own business" ON public.conversation_notes FOR SELECT USING (public.owns_business(business_id));
CREATE POLICY "insert notes in own business" ON public.conversation_notes FOR INSERT WITH CHECK (public.owns_business(business_id) AND author_id = auth.uid());
CREATE POLICY "update own notes" ON public.conversation_notes FOR UPDATE USING (author_id = auth.uid());
CREATE POLICY "delete own notes" ON public.conversation_notes FOR DELETE USING (author_id = auth.uid());

-- message templates
CREATE TABLE IF NOT EXISTS public.message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  name text NOT NULL,
  body text NOT NULL,
  category text DEFAULT 'general',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read templates in own business" ON public.message_templates FOR SELECT USING (public.owns_business(business_id));
CREATE POLICY "insert templates in own business" ON public.message_templates FOR INSERT WITH CHECK (public.owns_business(business_id));
CREATE POLICY "update templates in own business" ON public.message_templates FOR UPDATE USING (public.owns_business(business_id));
CREATE POLICY "delete templates in own business" ON public.message_templates FOR DELETE USING (public.owns_business(business_id));

-- reminders
CREATE TABLE IF NOT EXISTS public.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  due_at timestamptz NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read reminders in own business" ON public.reminders FOR SELECT USING (public.owns_business(business_id));
CREATE POLICY "insert reminders in own business" ON public.reminders FOR INSERT WITH CHECK (public.owns_business(business_id));
CREATE POLICY "update reminders in own business" ON public.reminders FOR UPDATE USING (public.owns_business(business_id));
CREATE POLICY "delete reminders in own business" ON public.reminders FOR DELETE USING (public.owns_business(business_id));
CREATE INDEX IF NOT EXISTS reminders_due_idx ON public.reminders (due_at) WHERE status = 'pending';

-- extend automation enums
DO $$ BEGIN
  ALTER TYPE automation_trigger ADD VALUE IF NOT EXISTS 'keyword_match';
EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE automation_trigger ADD VALUE IF NOT EXISTS 'out_of_hours';
EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE automation_trigger ADD VALUE IF NOT EXISTS 'first_message';
EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE automation_trigger ADD VALUE IF NOT EXISTS 'reminder_due';
EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE automation_action ADD VALUE IF NOT EXISTS 'send_template';
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- storage bucket for business assets
INSERT INTO storage.buckets (id, name, public) VALUES ('business-assets','business-assets', true)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public read business-assets" ON storage.objects FOR SELECT USING (bucket_id = 'business-assets');
CREATE POLICY "owner upload business-assets" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'business-assets' AND public.owns_business(((storage.foldername(name))[1])::uuid));
CREATE POLICY "owner update business-assets" ON storage.objects FOR UPDATE
  USING (bucket_id = 'business-assets' AND public.owns_business(((storage.foldername(name))[1])::uuid));
CREATE POLICY "owner delete business-assets" ON storage.objects FOR DELETE
  USING (bucket_id = 'business-assets' AND public.owns_business(((storage.foldername(name))[1])::uuid));
