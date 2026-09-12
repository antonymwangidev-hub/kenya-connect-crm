-- Keep channel credential access aligned with the team workspace permissions.
DROP POLICY IF EXISTS "read channel_credentials in own business" ON public.channel_credentials;
DROP POLICY IF EXISTS "insert channel_credentials in own business" ON public.channel_credentials;
DROP POLICY IF EXISTS "update channel_credentials in own business" ON public.channel_credentials;
DROP POLICY IF EXISTS "delete channel_credentials in own business" ON public.channel_credentials;

CREATE POLICY "members read channel_credentials"
  ON public.channel_credentials FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

CREATE POLICY "writers insert channel_credentials"
  ON public.channel_credentials FOR INSERT TO authenticated
  WITH CHECK (public.can_write_business(business_id));

CREATE POLICY "writers update channel_credentials"
  ON public.channel_credentials FOR UPDATE TO authenticated
  USING (public.can_write_business(business_id))
  WITH CHECK (public.can_write_business(business_id));

CREATE POLICY "writers delete channel_credentials"
  ON public.channel_credentials FOR DELETE TO authenticated
  USING (public.can_write_business(business_id));