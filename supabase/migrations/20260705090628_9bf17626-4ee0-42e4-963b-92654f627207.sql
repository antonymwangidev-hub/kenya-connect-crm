
CREATE TABLE public.ai_assistant_settings (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  business_description text,
  products_services text,
  contact_info text,
  address text,
  website text,
  hours text,
  faqs text,
  tone text NOT NULL DEFAULT 'friendly',
  custom_instructions text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_assistant_settings TO authenticated;
GRANT ALL ON public.ai_assistant_settings TO service_role;

ALTER TABLE public.ai_assistant_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view AI settings" ON public.ai_assistant_settings
  FOR SELECT TO authenticated USING (public.owns_business(business_id));
CREATE POLICY "Owners can insert AI settings" ON public.ai_assistant_settings
  FOR INSERT TO authenticated WITH CHECK (public.owns_business(business_id));
CREATE POLICY "Owners can update AI settings" ON public.ai_assistant_settings
  FOR UPDATE TO authenticated USING (public.owns_business(business_id)) WITH CHECK (public.owns_business(business_id));
CREATE POLICY "Owners can delete AI settings" ON public.ai_assistant_settings
  FOR DELETE TO authenticated USING (public.owns_business(business_id));

CREATE TRIGGER ai_assistant_settings_touch_updated_at
  BEFORE UPDATE ON public.ai_assistant_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
