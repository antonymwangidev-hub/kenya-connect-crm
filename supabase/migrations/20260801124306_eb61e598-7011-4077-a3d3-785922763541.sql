CREATE TABLE public.ai_knowledge_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  content text NOT NULL DEFAULT '',
  keywords text,
  priority integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_knowledge_entries TO authenticated;
GRANT ALL ON public.ai_knowledge_entries TO service_role;

ALTER TABLE public.ai_knowledge_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their knowledge entries"
  ON public.ai_knowledge_entries FOR SELECT TO authenticated
  USING (public.owns_business(business_id));

CREATE POLICY "Owners can insert their knowledge entries"
  ON public.ai_knowledge_entries FOR INSERT TO authenticated
  WITH CHECK (public.owns_business(business_id));

CREATE POLICY "Owners can update their knowledge entries"
  ON public.ai_knowledge_entries FOR UPDATE TO authenticated
  USING (public.owns_business(business_id))
  WITH CHECK (public.owns_business(business_id));

CREATE POLICY "Owners can delete their knowledge entries"
  ON public.ai_knowledge_entries FOR DELETE TO authenticated
  USING (public.owns_business(business_id));

CREATE INDEX ai_knowledge_entries_business_idx ON public.ai_knowledge_entries (business_id, is_active, priority DESC);

CREATE TRIGGER ai_knowledge_entries_touch
  BEFORE UPDATE ON public.ai_knowledge_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.ai_assistant_settings
  ADD COLUMN IF NOT EXISTS strict_knowledge boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS fallback_message text;