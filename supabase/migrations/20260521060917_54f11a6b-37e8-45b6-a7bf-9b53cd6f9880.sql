
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  contact_id uuid NOT NULL UNIQUE,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_preview text,
  last_direction text,
  unread_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_business_last ON public.conversations(business_id, last_message_at DESC);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read conversations in own business" ON public.conversations
  FOR SELECT USING (public.owns_business(business_id));
CREATE POLICY "insert conversations in own business" ON public.conversations
  FOR INSERT WITH CHECK (public.owns_business(business_id));
CREATE POLICY "update conversations in own business" ON public.conversations
  FOR UPDATE USING (public.owns_business(business_id));
CREATE POLICY "delete conversations in own business" ON public.conversations
  FOR DELETE USING (public.owns_business(business_id));

ALTER TABLE public.messages ADD COLUMN conversation_id uuid;
CREATE INDEX idx_messages_conversation ON public.messages(conversation_id, created_at);

INSERT INTO public.conversations (business_id, contact_id, last_message_at, last_message_preview, last_direction)
SELECT c.business_id, c.id,
       COALESCE((SELECT MAX(created_at) FROM public.messages WHERE contact_id = c.id), c.created_at),
       (SELECT content FROM public.messages WHERE contact_id = c.id ORDER BY created_at DESC LIMIT 1),
       (SELECT direction::text FROM public.messages WHERE contact_id = c.id ORDER BY created_at DESC LIMIT 1)
FROM public.contacts c;

UPDATE public.messages m
SET conversation_id = c.id
FROM public.conversations c
WHERE c.contact_id = m.contact_id AND m.conversation_id IS NULL;

CREATE OR REPLACE FUNCTION public.create_conversation_for_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.conversations (business_id, contact_id)
  VALUES (NEW.business_id, NEW.id)
  ON CONFLICT (contact_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contact_create_conversation
AFTER INSERT ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.create_conversation_for_contact();

CREATE OR REPLACE FUNCTION public.set_message_conversation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  conv_id uuid;
  biz_id uuid;
BEGIN
  IF NEW.conversation_id IS NULL THEN
    SELECT id INTO conv_id FROM public.conversations WHERE contact_id = NEW.contact_id;
    IF conv_id IS NULL THEN
      SELECT business_id INTO biz_id FROM public.contacts WHERE id = NEW.contact_id;
      INSERT INTO public.conversations (business_id, contact_id)
      VALUES (biz_id, NEW.contact_id)
      RETURNING id INTO conv_id;
    END IF;
    NEW.conversation_id := conv_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_message_set_conversation
BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.set_message_conversation();

CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at,
      last_message_preview = LEFT(NEW.content, 200),
      last_direction = NEW.direction::text,
      unread_count = CASE WHEN NEW.direction::text = 'inbound'
                          THEN unread_count + 1 ELSE unread_count END
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_message_update_conversation
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.update_conversation_on_message();

ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
