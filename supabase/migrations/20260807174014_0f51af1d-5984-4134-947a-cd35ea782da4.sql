-- 1. Lock down SECURITY DEFINER functions that should never be callable via the API
REVOKE ALL ON FUNCTION public.create_conversation_for_contact() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_message_conversation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_conversation_on_message() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rate_limit_check(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_check(text, text, integer, integer) TO service_role;

-- Helper predicates used inside RLS policies: signed-in users need them, anonymous users do not
REVOKE ALL ON FUNCTION public.owns_business(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owns_contact(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_business_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_business(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_contact(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_conversation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.member_of_contact(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.member_of_conversation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_business_role(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_membership() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.business_performance_metrics(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owns_business(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_contact(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_business_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_business(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_contact(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.member_of_contact(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.member_of_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_business_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_membership() TO authenticated;
GRANT EXECUTE ON FUNCTION public.business_performance_metrics(uuid) TO authenticated;

-- 2. rate_limits: service-role only, documented deny-by-default
REVOKE ALL ON TABLE public.rate_limits FROM anon, authenticated;
GRANT ALL ON TABLE public.rate_limits TO service_role;
COMMENT ON TABLE public.rate_limits IS 'Internal rate limiting counters. RLS enabled with no policies on purpose: only service_role (which bypasses RLS) may read or write.';

-- 3. Owner cleanup policies for log/audit tables
CREATE POLICY "owners delete their message_delivery_logs"
ON public.message_delivery_logs FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_delivery_logs.message_id AND public.owns_contact(m.contact_id)));
GRANT DELETE ON public.message_delivery_logs TO authenticated;

CREATE POLICY "owners delete their webhook_logs"
ON public.webhook_logs FOR DELETE TO authenticated
USING (business_id IS NOT NULL AND public.owns_business(business_id));
GRANT DELETE ON public.webhook_logs TO authenticated;

CREATE POLICY "owners delete their payment_transactions"
ON public.payment_transactions FOR DELETE TO authenticated
USING (public.owns_business(business_id));
GRANT DELETE ON public.payment_transactions TO authenticated;

-- 4. virtual_numbers: signed-in users only; unassigned inventory stays hidden from the Data API
REVOKE ALL ON TABLE public.virtual_numbers FROM anon;
DROP POLICY IF EXISTS "read own virtual_numbers" ON public.virtual_numbers;
DROP POLICY IF EXISTS "insert virtual_numbers in own business" ON public.virtual_numbers;
DROP POLICY IF EXISTS "update virtual_numbers in own business" ON public.virtual_numbers;
DROP POLICY IF EXISTS "delete virtual_numbers in own business" ON public.virtual_numbers;
CREATE POLICY "read own virtual_numbers" ON public.virtual_numbers FOR SELECT TO authenticated
USING (business_id IS NOT NULL AND public.owns_business(business_id));
CREATE POLICY "insert virtual_numbers in own business" ON public.virtual_numbers FOR INSERT TO authenticated
WITH CHECK (business_id IS NOT NULL AND public.owns_business(business_id));
CREATE POLICY "update virtual_numbers in own business" ON public.virtual_numbers FOR UPDATE TO authenticated
USING (business_id IS NOT NULL AND public.owns_business(business_id))
WITH CHECK (business_id IS NOT NULL AND public.owns_business(business_id));
CREATE POLICY "delete virtual_numbers in own business" ON public.virtual_numbers FOR DELETE TO authenticated
USING (business_id IS NOT NULL AND public.owns_business(business_id));

-- 5. Storage: stop anonymous listing of the public business-assets bucket
DROP POLICY IF EXISTS "public read business-assets" ON storage.objects;
CREATE POLICY "owners list business-assets" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'business-assets' AND public.owns_business(((storage.foldername(name))[1])::uuid));

-- 6. Storage: chat-media write policies use the folder path, not the storage owner column
DROP POLICY IF EXISTS "chat-media auth update" ON storage.objects;
DROP POLICY IF EXISTS "chat-media auth delete" ON storage.objects;
CREATE POLICY "chat-media auth update" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'chat-media' AND (storage.foldername(name))[1] = (auth.uid())::text)
WITH CHECK (bucket_id = 'chat-media' AND (storage.foldername(name))[1] = (auth.uid())::text);
CREATE POLICY "chat-media auth delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'chat-media' AND (storage.foldername(name))[1] = (auth.uid())::text);