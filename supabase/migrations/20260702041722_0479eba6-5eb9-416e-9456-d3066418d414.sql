
-- 1) whatsapp_business_accounts
CREATE TABLE public.whatsapp_business_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  business_name text NOT NULL,
  waba_id text NOT NULL,
  phone_number_id text NOT NULL,
  access_token text,
  status text NOT NULL DEFAULT 'connected',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, waba_id, phone_number_id)
);

CREATE INDEX idx_wa_accounts_business ON public.whatsapp_business_accounts(business_id);
CREATE INDEX idx_wa_accounts_phone_number_id ON public.whatsapp_business_accounts(phone_number_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_business_accounts TO authenticated;
GRANT ALL ON public.whatsapp_business_accounts TO service_role;

ALTER TABLE public.whatsapp_business_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_accounts owner read" ON public.whatsapp_business_accounts
  FOR SELECT TO authenticated USING (public.owns_business(business_id));
CREATE POLICY "wa_accounts owner insert" ON public.whatsapp_business_accounts
  FOR INSERT TO authenticated WITH CHECK (public.owns_business(business_id));
CREATE POLICY "wa_accounts owner update" ON public.whatsapp_business_accounts
  FOR UPDATE TO authenticated USING (public.owns_business(business_id))
  WITH CHECK (public.owns_business(business_id));
CREATE POLICY "wa_accounts owner delete" ON public.whatsapp_business_accounts
  FOR DELETE TO authenticated USING (public.owns_business(business_id));

CREATE TRIGGER trg_wa_accounts_updated
  BEFORE UPDATE ON public.whatsapp_business_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) Backfill from existing whatsapp_connections
INSERT INTO public.whatsapp_business_accounts
  (business_id, business_name, waba_id, phone_number_id, access_token, status, meta, created_at)
SELECT
  c.business_id,
  COALESCE(NULLIF(c.display_name, ''), c.phone_number, 'WhatsApp Account') AS business_name,
  COALESCE(NULLIF(c.waba_id, ''), 'unknown') AS waba_id,
  c.phone_number_id,
  NULLIF(c.meta->>'access_token', '') AS access_token,
  c.status,
  jsonb_build_object('phone_number', c.phone_number, 'source_connection_id', c.id),
  c.created_at
FROM public.whatsapp_connections c
WHERE c.status = 'connected'
  AND c.phone_number_id IS NOT NULL
  AND c.phone_number_id <> ''
ON CONFLICT (business_id, waba_id, phone_number_id) DO NOTHING;

-- 3) whatsapp_templates: link to business account
ALTER TABLE public.whatsapp_templates
  ADD COLUMN IF NOT EXISTS business_account_id uuid
    REFERENCES public.whatsapp_business_accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_wa_templates_account ON public.whatsapp_templates(business_account_id);

-- Backfill by matching business_id + waba_id
UPDATE public.whatsapp_templates t
SET business_account_id = a.id
FROM public.whatsapp_business_accounts a
WHERE t.business_account_id IS NULL
  AND t.business_id = a.business_id
  AND t.waba_id IS NOT NULL
  AND t.waba_id = a.waba_id;

-- Delete orphan templates (waba_id no longer maps to a live account)
DELETE FROM public.whatsapp_templates WHERE business_account_id IS NULL;

ALTER TABLE public.whatsapp_templates
  ALTER COLUMN business_account_id SET NOT NULL;

-- Swap unique constraint: (business_id,name,language) -> (business_account_id,name,language)
ALTER TABLE public.whatsapp_templates
  DROP CONSTRAINT IF EXISTS whatsapp_templates_business_id_name_language_key;
ALTER TABLE public.whatsapp_templates
  ADD CONSTRAINT whatsapp_templates_account_name_language_key
  UNIQUE (business_account_id, name, language);
