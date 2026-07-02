
DROP POLICY IF EXISTS "chat-media auth read" ON storage.objects;
DROP POLICY IF EXISTS "chat-media auth insert" ON storage.objects;

CREATE POLICY "chat-media auth read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "chat-media auth insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
