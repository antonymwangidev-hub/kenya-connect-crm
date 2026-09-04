-- Remove direct client read access to tables that hold provider secrets.
-- All application reads now go through server-side code (service role) after
-- verifying business ownership; only masked/safe fields reach the browser.

DROP POLICY IF EXISTS "read channel_credentials in own business" ON public.channel_credentials;
DROP POLICY IF EXISTS "wa_accounts owner read" ON public.whatsapp_business_accounts;
DROP POLICY IF EXISTS "Users can view their own gateway settings" ON public.gateway_settings;
DROP POLICY IF EXISTS "Users can insert their own gateway settings" ON public.gateway_settings;
DROP POLICY IF EXISTS "Users can update their own gateway settings" ON public.gateway_settings;

REVOKE ALL ON public.gateway_settings FROM anon, authenticated;
REVOKE SELECT ON public.channel_credentials FROM anon, authenticated;
REVOKE SELECT ON public.whatsapp_business_accounts FROM anon, authenticated;

GRANT ALL ON public.gateway_settings TO service_role;
GRANT ALL ON public.channel_credentials TO service_role;
GRANT ALL ON public.whatsapp_business_accounts TO service_role;