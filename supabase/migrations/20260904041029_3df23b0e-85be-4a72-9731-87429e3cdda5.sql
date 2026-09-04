ALTER TABLE public.gateway_settings
  ADD COLUMN IF NOT EXISTS webhook_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS webhook_secret_source text NOT NULL DEFAULT 'auto';

CREATE UNIQUE INDEX IF NOT EXISTS gateway_settings_webhook_token_key ON public.gateway_settings (webhook_token);