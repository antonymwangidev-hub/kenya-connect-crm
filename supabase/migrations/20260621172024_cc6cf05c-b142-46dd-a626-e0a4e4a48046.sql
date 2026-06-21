
INSERT INTO public.conversations (business_id, contact_id)
SELECT c.business_id, c.id FROM public.contacts c
LEFT JOIN public.conversations cv ON cv.contact_id = c.id
WHERE cv.id IS NULL;

UPDATE public.messages m
SET conversation_id = cv.id
FROM public.conversations cv
WHERE m.conversation_id IS NULL AND cv.contact_id = m.contact_id;

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
