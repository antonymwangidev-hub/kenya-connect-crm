
-- ============ roles / members ============
DO $$ BEGIN
  CREATE TYPE public.member_role AS ENUM ('admin','agent','viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.business_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid,
  email text NOT NULL,
  display_name text,
  role public.member_role NOT NULL DEFAULT 'agent',
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, email)
);
CREATE INDEX IF NOT EXISTS business_members_user_idx ON public.business_members(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_members TO authenticated;
GRANT ALL ON public.business_members TO service_role;
ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;

-- helper functions (security definer, avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_business_member(_business_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = _business_id AND b.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id = _business_id AND m.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.my_business_role(_business_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = _business_id AND b.owner_id = auth.uid()) THEN 'admin'
    ELSE (SELECT m.role::text FROM public.business_members m
          WHERE m.business_id = _business_id AND m.user_id = auth.uid() LIMIT 1)
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_write_business(_business_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.my_business_role(_business_id) IN ('admin','agent');
$$;

CREATE OR REPLACE FUNCTION public.member_of_contact(_contact_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = _contact_id AND public.is_business_member(c.business_id));
$$;

CREATE OR REPLACE FUNCTION public.can_write_contact(_contact_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = _contact_id AND public.can_write_business(c.business_id));
$$;

CREATE POLICY "members read team" ON public.business_members FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY "owners manage team insert" ON public.business_members FOR INSERT TO authenticated
  WITH CHECK (public.owns_business(business_id));
CREATE POLICY "owners manage team update" ON public.business_members FOR UPDATE TO authenticated
  USING (public.owns_business(business_id)) WITH CHECK (public.owns_business(business_id));
CREATE POLICY "owners manage team delete" ON public.business_members FOR DELETE TO authenticated
  USING (public.owns_business(business_id));

-- link an invited member to their auth user on first sign-in
CREATE OR REPLACE FUNCTION public.claim_membership()
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.business_members m
     SET user_id = auth.uid(), updated_at = now()
   WHERE m.user_id IS NULL
     AND lower(m.email) = lower(coalesce((auth.jwt() ->> 'email'), ''));
$$;
GRANT EXECUTE ON FUNCTION public.claim_membership() TO authenticated;

-- ============ conversation status / assignment ============
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_by uuid;

DO $$ BEGIN
  ALTER TABLE public.conversations ADD CONSTRAINT conversations_status_check
    CHECK (status IN ('open','pending','resolved','spam'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS conversations_status_idx ON public.conversations(business_id, status);
CREATE INDEX IF NOT EXISTS conversations_assigned_idx ON public.conversations(business_id, assigned_to);

-- ============ conversation labels ============
CREATE TABLE IF NOT EXISTS public.conversation_labels (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, tag_id)
);
GRANT SELECT, INSERT, DELETE ON public.conversation_labels TO authenticated;
GRANT ALL ON public.conversation_labels TO service_role;
ALTER TABLE public.conversation_labels ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.member_of_conversation(_conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = _conversation_id AND public.is_business_member(c.business_id));
$$;
CREATE OR REPLACE FUNCTION public.can_write_conversation(_conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = _conversation_id AND public.can_write_business(c.business_id));
$$;

CREATE POLICY "labels read" ON public.conversation_labels FOR SELECT TO authenticated
  USING (public.member_of_conversation(conversation_id));
CREATE POLICY "labels insert" ON public.conversation_labels FOR INSERT TO authenticated
  WITH CHECK (public.can_write_conversation(conversation_id));
CREATE POLICY "labels delete" ON public.conversation_labels FOR DELETE TO authenticated
  USING (public.can_write_conversation(conversation_id));

-- ============ inbox settings ============
CREATE TABLE IF NOT EXISTS public.inbox_settings (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'Africa/Nairobi',
  open_hour integer NOT NULL DEFAULT 8,
  close_hour integer NOT NULL DEFAULT 18,
  open_days integer[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  out_of_hours_enabled boolean NOT NULL DEFAULT false,
  out_of_hours_message text NOT NULL DEFAULT 'Thanks for reaching out! We are currently closed. Our team replies from 8am to 6pm and will get back to you then.',
  mpesa_autotag_enabled boolean NOT NULL DEFAULT true,
  broadcast_rate_per_sec integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbox_settings TO authenticated;
GRANT ALL ON public.inbox_settings TO service_role;
ALTER TABLE public.inbox_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inbox settings read" ON public.inbox_settings FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY "inbox settings insert" ON public.inbox_settings FOR INSERT TO authenticated
  WITH CHECK (public.owns_business(business_id));
CREATE POLICY "inbox settings update" ON public.inbox_settings FOR UPDATE TO authenticated
  USING (public.owns_business(business_id)) WITH CHECK (public.owns_business(business_id));
CREATE POLICY "inbox settings delete" ON public.inbox_settings FOR DELETE TO authenticated
  USING (public.owns_business(business_id));

CREATE TRIGGER inbox_settings_touch BEFORE UPDATE ON public.inbox_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER business_members_touch BEFORE UPDATE ON public.business_members
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ team access to existing inbox tables ============
CREATE POLICY "team read conversations" ON public.conversations FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY "team update conversations" ON public.conversations FOR UPDATE TO authenticated
  USING (public.can_write_business(business_id)) WITH CHECK (public.can_write_business(business_id));

CREATE POLICY "team read contacts" ON public.contacts FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY "team update contacts" ON public.contacts FOR UPDATE TO authenticated
  USING (public.can_write_business(business_id)) WITH CHECK (public.can_write_business(business_id));
CREATE POLICY "team insert contacts" ON public.contacts FOR INSERT TO authenticated
  WITH CHECK (public.can_write_business(business_id));

CREATE POLICY "team read messages" ON public.messages FOR SELECT TO authenticated
  USING (public.member_of_contact(contact_id));
CREATE POLICY "team insert messages" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (public.can_write_contact(contact_id));

CREATE POLICY "team read notes" ON public.conversation_notes FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY "team insert notes" ON public.conversation_notes FOR INSERT TO authenticated
  WITH CHECK (public.can_write_business(business_id) AND author_id = auth.uid());
CREATE POLICY "team delete own notes" ON public.conversation_notes FOR DELETE TO authenticated
  USING (author_id = auth.uid() AND public.is_business_member(business_id));

CREATE POLICY "team read tags" ON public.tags FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY "team insert tags" ON public.tags FOR INSERT TO authenticated
  WITH CHECK (public.can_write_business(business_id));

CREATE POLICY "team read templates" ON public.message_templates FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

CREATE POLICY "team read businesses" ON public.businesses FOR SELECT TO authenticated
  USING (public.is_business_member(id));

-- ============ realtime ============
ALTER TABLE public.conversation_labels REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_notes REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_labels;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_notes;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
