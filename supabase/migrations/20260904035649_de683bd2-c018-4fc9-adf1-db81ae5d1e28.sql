-- 1) contact_tags: tag must belong to the same business as the contact
DROP POLICY IF EXISTS "insert contact_tags of own contacts" ON public.contact_tags;
CREATE POLICY "insert contact_tags of own contacts"
ON public.contact_tags
FOR INSERT
TO authenticated
WITH CHECK (
  public.owns_contact(contact_id)
  AND EXISTS (
    SELECT 1
    FROM public.tags t
    JOIN public.contacts c ON c.id = contact_id
    WHERE t.id = tag_id
      AND t.business_id = c.business_id
  )
);

-- 2) conversation_labels: tag must belong to the same business as the conversation
DROP POLICY IF EXISTS "labels insert" ON public.conversation_labels;
CREATE POLICY "labels insert"
ON public.conversation_labels
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_write_conversation(conversation_id)
  AND EXISTS (
    SELECT 1
    FROM public.tags t
    JOIN public.conversations cv ON cv.id = conversation_id
    WHERE t.id = tag_id
      AND t.business_id = cv.business_id
  )
);

-- 3) ensure_default_scoring_rules: enforce membership before inserting defaults
CREATE OR REPLACE FUNCTION public.ensure_default_scoring_rules(_business_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_business_member(_business_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  INSERT INTO public.scoring_rules (business_id, key, name, description, weight, config)
  VALUES
    (_business_id, 'stage', 'Pipeline stage', 'Points for how far the lead has moved in the pipeline.', 8,
     '{"new":1,"interested":2,"negotiation":3,"paid":5,"lost":0}'::jsonb),
    (_business_id, 'inbound_activity', 'Recent replies', 'Points per inbound message in the last 30 days.', 3,
     '{"window_days":30,"cap":10}'::jsonb),
    (_business_id, 'outbound_engagement', 'Outreach effort', 'Points per outbound message in the last 30 days.', 1,
     '{"window_days":30,"cap":10}'::jsonb),
    (_business_id, 'revenue', 'Revenue recorded', 'Points per 1,000 of revenue attributed to the lead.', 4,
     '{"per_amount":1000,"cap":10}'::jsonb),
    (_business_id, 'recency', 'Reply recency', 'Points when the lead replied recently.', 15,
     '{"day1":1,"day3":0.8,"day7":0.6,"day30":0.3}'::jsonb),
    (_business_id, 'dormant_penalty', 'Dormant penalty', 'Multiplier applied when the lead has been silent for a long time.', 0.5,
     '{"days":90}'::jsonb)
  ON CONFLICT (business_id, key) DO NOTHING;
END;
$function$;