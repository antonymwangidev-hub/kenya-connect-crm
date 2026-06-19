
-- 1. Add DELETE policy on broadcast_recipients
DROP POLICY IF EXISTS "Owners can delete broadcast recipients" ON public.broadcast_recipients;
CREATE POLICY "Owners can delete broadcast recipients"
ON public.broadcast_recipients FOR DELETE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.broadcasts b
  WHERE b.id = broadcast_recipients.broadcast_id
    AND public.owns_business(b.business_id)
));

-- 2. Remove every UPDATE policy on payment_transactions (make immutable to clients)
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='payment_transactions' AND cmd='UPDATE'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.payment_transactions', p.policyname);
  END LOOP;
END $$;

-- 3. Owner-scoped storage policies for business-verification-docs (path: {business_id}/...)
DROP POLICY IF EXISTS "verif_docs_owner_select" ON storage.objects;
DROP POLICY IF EXISTS "verif_docs_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "verif_docs_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "verif_docs_owner_delete" ON storage.objects;

CREATE POLICY "verif_docs_owner_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'business-verification-docs'
  AND public.owns_business(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "verif_docs_owner_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'business-verification-docs'
  AND public.owns_business(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "verif_docs_owner_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'business-verification-docs'
  AND public.owns_business(((storage.foldername(name))[1])::uuid)
)
WITH CHECK (
  bucket_id = 'business-verification-docs'
  AND public.owns_business(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "verif_docs_owner_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'business-verification-docs'
  AND public.owns_business(((storage.foldername(name))[1])::uuid)
);
