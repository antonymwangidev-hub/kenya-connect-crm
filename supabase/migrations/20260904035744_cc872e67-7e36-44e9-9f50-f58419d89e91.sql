-- Restore full recalc_lead_score with authorization check; align membership checks so
-- service-role/cron/trigger contexts (auth.uid() IS NULL) keep working while direct
-- authenticated calls require membership in the target business.

CREATE OR REPLACE FUNCTION public.ensure_default_scoring_rules(_business_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_business_member(_business_id) THEN
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

CREATE OR REPLACE FUNCTION public.recalc_business_lead_scores(_business_id uuid, _reason text DEFAULT 'batch'::text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r record; n int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_business_member(_business_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  FOR r IN SELECT id FROM public.contacts WHERE business_id = _business_id LOOP
    PERFORM public.recalc_lead_score(r.id, _reason);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalc_lead_score(_contact_id uuid, _reason text DEFAULT 'manual'::text)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  biz uuid;
  c_stage text;
  old numeric := 0;
  score numeric := 0;
  part numeric;
  w numeric;
  cfg jsonb;
  inbound_cnt int := 0;
  outbound_cnt int := 0;
  rev numeric := 0;
  last_in timestamptz;
  days numeric;
  factor numeric;
  parts jsonb := '{}'::jsonb;
BEGIN
  SELECT business_id, stage::text, coalesce(lead_score, 0)
    INTO biz, c_stage, old
  FROM public.contacts WHERE id = _contact_id;

  IF biz IS NULL THEN RETURN NULL; END IF;

  IF auth.uid() IS NOT NULL AND NOT public.is_business_member(biz) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  PERFORM public.ensure_default_scoring_rules(biz);

  SELECT weight, config INTO w, cfg FROM public.scoring_rules
   WHERE business_id = biz AND key = 'stage' AND is_active;
  IF w IS NOT NULL THEN
    part := w * coalesce((cfg ->> c_stage)::numeric, 0);
    score := score + part;
    parts := parts || jsonb_build_object('stage', part);
  END IF;

  SELECT weight, config INTO w, cfg FROM public.scoring_rules
   WHERE business_id = biz AND key = 'inbound_activity' AND is_active;
  IF w IS NOT NULL THEN
    SELECT count(*) INTO inbound_cnt FROM public.messages m
     WHERE m.contact_id = _contact_id AND m.direction = 'inbound'
       AND m.created_at > now() - (coalesce((cfg ->> 'window_days')::int, 30) || ' days')::interval;
    part := w * least(inbound_cnt, coalesce((cfg ->> 'cap')::int, 10));
    score := score + part;
    parts := parts || jsonb_build_object('inbound_activity', part);
  END IF;

  SELECT weight, config INTO w, cfg FROM public.scoring_rules
   WHERE business_id = biz AND key = 'outbound_engagement' AND is_active;
  IF w IS NOT NULL THEN
    SELECT count(*) INTO outbound_cnt FROM public.messages m
     WHERE m.contact_id = _contact_id AND m.direction = 'outbound'
       AND m.created_at > now() - (coalesce((cfg ->> 'window_days')::int, 30) || ' days')::interval;
    part := w * least(outbound_cnt, coalesce((cfg ->> 'cap')::int, 10));
    score := score + part;
    parts := parts || jsonb_build_object('outbound_engagement', part);
  END IF;

  SELECT weight, config INTO w, cfg FROM public.scoring_rules
   WHERE business_id = biz AND key = 'revenue' AND is_active;
  IF w IS NOT NULL THEN
    SELECT coalesce(sum(amount), 0) INTO rev FROM public.revenue_entries
     WHERE contact_id = _contact_id;
    part := w * least(rev / greatest(coalesce((cfg ->> 'per_amount')::numeric, 1000), 1),
                      coalesce((cfg ->> 'cap')::numeric, 10));
    score := score + part;
    parts := parts || jsonb_build_object('revenue', part);
  END IF;

  SELECT max(m.created_at) INTO last_in FROM public.messages m
   WHERE m.contact_id = _contact_id AND m.direction = 'inbound';

  SELECT weight, config INTO w, cfg FROM public.scoring_rules
   WHERE business_id = biz AND key = 'recency' AND is_active;
  IF w IS NOT NULL AND last_in IS NOT NULL THEN
    days := extract(epoch FROM (now() - last_in)) / 86400.0;
    factor := CASE
      WHEN days <= 1 THEN coalesce((cfg ->> 'day1')::numeric, 1)
      WHEN days <= 3 THEN coalesce((cfg ->> 'day3')::numeric, 0.8)
      WHEN days <= 7 THEN coalesce((cfg ->> 'day7')::numeric, 0.6)
      WHEN days <= 30 THEN coalesce((cfg ->> 'day30')::numeric, 0.3)
      ELSE 0 END;
    part := w * factor;
    score := score + part;
    parts := parts || jsonb_build_object('recency', part);
  END IF;

  SELECT weight, config INTO w, cfg FROM public.scoring_rules
   WHERE business_id = biz AND key = 'dormant_penalty' AND is_active;
  IF w IS NOT NULL THEN
    IF last_in IS NULL OR last_in < now() - (coalesce((cfg ->> 'days')::int, 90) || ' days')::interval THEN
      score := score * greatest(w, 0);
      parts := parts || jsonb_build_object('dormant_penalty', w);
    END IF;
  END IF;

  score := round(greatest(least(score, 100), 0)::numeric, 1);

  UPDATE public.contacts
     SET lead_score = score, lead_score_updated_at = now()
   WHERE id = _contact_id;

  IF old IS DISTINCT FROM score THEN
    INSERT INTO public.lead_score_history (business_id, contact_id, old_score, new_score, reason, breakdown)
    VALUES (biz, _contact_id, old, score, _reason, parts);
  END IF;

  PERFORM public.route_lead(_contact_id);

  RETURN score;
END;
$function$;