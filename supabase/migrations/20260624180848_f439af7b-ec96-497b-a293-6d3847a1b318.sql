WITH whatsapp_creds AS (
  SELECT
    business_id,
    NULLIF(TRIM(credentials->>'phone_number_id'), '') AS phone_number_id,
    NULLIF(TRIM(COALESCE(credentials->>'waba_id', credentials->>'business_account_id')), '') AS waba_id
  FROM public.channel_credentials
  WHERE provider = 'whatsapp'
    AND is_active = true
    AND NULLIF(TRIM(credentials->>'phone_number_id'), '') IS NOT NULL
), latest_null_connection AS (
  SELECT DISTINCT ON (wc.business_id)
    wc.id,
    wc.business_id
  FROM public.whatsapp_connections wc
  JOIN whatsapp_creds c ON c.business_id = wc.business_id
  WHERE wc.phone_number_id IS NULL
  ORDER BY wc.business_id, wc.connected_at DESC NULLS LAST, wc.created_at DESC
)
UPDATE public.whatsapp_connections wc
SET phone_number_id = c.phone_number_id,
    waba_id = COALESCE(wc.waba_id, c.waba_id),
    status = 'connected',
    connected_at = COALESCE(wc.connected_at, now()),
    meta = COALESCE(wc.meta, '{}'::jsonb) || jsonb_build_object('phone_number_id_source', 'channel_credentials_backfill'),
    updated_at = now()
FROM whatsapp_creds c
JOIN latest_null_connection l ON l.business_id = c.business_id
WHERE wc.id = l.id
  AND NOT EXISTS (
    SELECT 1
    FROM public.whatsapp_connections existing
    WHERE existing.phone_number_id = c.phone_number_id
      AND existing.id <> wc.id
  );

WITH whatsapp_creds AS (
  SELECT
    business_id,
    NULLIF(TRIM(credentials->>'phone_number_id'), '') AS phone_number_id,
    NULLIF(TRIM(COALESCE(credentials->>'waba_id', credentials->>'business_account_id')), '') AS waba_id
  FROM public.channel_credentials
  WHERE provider = 'whatsapp'
    AND is_active = true
    AND NULLIF(TRIM(credentials->>'phone_number_id'), '') IS NOT NULL
)
INSERT INTO public.whatsapp_connections (
  business_id,
  phone_number,
  phone_number_id,
  waba_id,
  display_name,
  status,
  quality_rating,
  connected_at,
  meta
)
SELECT
  c.business_id,
  'configured',
  c.phone_number_id,
  c.waba_id,
  'WhatsApp Cloud API',
  'connected',
  'GREEN',
  now(),
  jsonb_build_object('source', 'channel_credentials_backfill')
FROM whatsapp_creds c
WHERE NOT EXISTS (
  SELECT 1 FROM public.whatsapp_connections wc WHERE wc.phone_number_id = c.phone_number_id
);

DROP TRIGGER IF EXISTS trg_contact_create_conversation ON public.contacts;
DROP TRIGGER IF EXISTS trg_message_set_conversation ON public.messages;
DROP TRIGGER IF EXISTS trg_message_update_conversation ON public.messages;

DROP TRIGGER IF EXISTS trg_create_conversation_for_contact ON public.contacts;
CREATE TRIGGER trg_create_conversation_for_contact
AFTER INSERT ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.create_conversation_for_contact();

DROP TRIGGER IF EXISTS trg_set_message_conversation ON public.messages;
CREATE TRIGGER trg_set_message_conversation
BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.set_message_conversation();

DROP TRIGGER IF EXISTS trg_update_conversation_on_message ON public.messages;
CREATE TRIGGER trg_update_conversation_on_message
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.update_conversation_on_message();

ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;