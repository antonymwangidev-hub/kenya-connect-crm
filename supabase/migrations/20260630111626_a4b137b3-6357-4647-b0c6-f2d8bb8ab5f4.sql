
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;

UPDATE public.conversations c
SET last_inbound_at = sub.max_in
FROM (
  SELECT conversation_id, MAX(created_at) AS max_in
  FROM public.messages
  WHERE direction = 'inbound' AND conversation_id IS NOT NULL
  GROUP BY conversation_id
) sub
WHERE sub.conversation_id = c.id AND c.last_inbound_at IS NULL;

CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at,
      last_message_preview = LEFT(NEW.content, 200),
      last_direction = NEW.direction::text,
      last_inbound_at = CASE WHEN NEW.direction::text = 'inbound'
                             THEN NEW.created_at ELSE last_inbound_at END,
      unread_count = CASE WHEN NEW.direction::text = 'inbound'
                          THEN unread_count + 1 ELSE unread_count END
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$function$;

CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  waba_id text,
  meta_template_id text,
  name text NOT NULL,
  language text NOT NULL,
  category text,
  status text NOT NULL DEFAULT 'APPROVED',
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name, language)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_business ON public.whatsapp_templates(business_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_templates TO authenticated;
GRANT ALL ON public.whatsapp_templates TO service_role;

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their wa templates" ON public.whatsapp_templates
  FOR SELECT TO authenticated USING (public.owns_business(business_id));
CREATE POLICY "Owners insert their wa templates" ON public.whatsapp_templates
  FOR INSERT TO authenticated WITH CHECK (public.owns_business(business_id));
CREATE POLICY "Owners update their wa templates" ON public.whatsapp_templates
  FOR UPDATE TO authenticated USING (public.owns_business(business_id)) WITH CHECK (public.owns_business(business_id));
CREATE POLICY "Owners delete their wa templates" ON public.whatsapp_templates
  FOR DELETE TO authenticated USING (public.owns_business(business_id));

CREATE TRIGGER trg_whatsapp_templates_updated
  BEFORE UPDATE ON public.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.whatsapp_template_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  status text NOT NULL,
  synced_count integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.whatsapp_template_sync_logs TO authenticated;
GRANT ALL ON public.whatsapp_template_sync_logs TO service_role;

ALTER TABLE public.whatsapp_template_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read sync logs" ON public.whatsapp_template_sync_logs
  FOR SELECT TO authenticated USING (public.owns_business(business_id));
CREATE POLICY "Owners insert sync logs" ON public.whatsapp_template_sync_logs
  FOR INSERT TO authenticated WITH CHECK (public.owns_business(business_id));
