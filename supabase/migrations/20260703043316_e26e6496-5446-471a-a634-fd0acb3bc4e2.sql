-- Allow the same Meta provider_message_id across different tenants (contacts)
-- so inbound messages can fan out to multiple businesses connected to the
-- same WhatsApp phone number.
DROP INDEX IF EXISTS public.messages_provider_message_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS messages_contact_provider_message_id_unique
  ON public.messages (contact_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;