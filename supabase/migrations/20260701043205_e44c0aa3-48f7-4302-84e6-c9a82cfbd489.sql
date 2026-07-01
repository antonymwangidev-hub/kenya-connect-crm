
DROP POLICY IF EXISTS "chat-media auth read" ON storage.objects;
CREATE POLICY "chat-media auth read" ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'chat-media');

DROP POLICY IF EXISTS "chat-media auth insert" ON storage.objects;
CREATE POLICY "chat-media auth insert" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'chat-media');

DROP POLICY IF EXISTS "chat-media auth update" ON storage.objects;
CREATE POLICY "chat-media auth update" ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'chat-media' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'chat-media' AND owner = auth.uid());

DROP POLICY IF EXISTS "chat-media auth delete" ON storage.objects;
CREATE POLICY "chat-media auth delete" ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'chat-media' AND owner = auth.uid());
