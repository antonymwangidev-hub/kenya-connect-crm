
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS media_mime text,
  ADD COLUMN IF NOT EXISTS media_filename text,
  ADD COLUMN IF NOT EXISTS media_size bigint;

DELETE FROM public.whatsapp_connections
WHERE phone_number_id IS NULL AND waba_id IS NULL;
