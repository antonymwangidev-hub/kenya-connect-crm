-- Harden recalc_lead_score: authenticated callers may only rescore contacts in businesses they belong to.
-- Trigger/service-role invocations (auth.uid() IS NULL) are unaffected.
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
  IF biz IS NULL THEN
    RETURN 0;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.is_business_member(biz) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  FOR w, cfg IN
    SELECT weight, config FROM public.scoring_rules WHERE business_id = biz AND is_active
  LOOP
    part := 0;
    IF cfg ? 'window_days' THEN
      inbound_cnt := coalesce((SELECT count(*) FROM public.messages m
        WHERE m.contact_id = _contact_id AND m.direction = 'inbound'
          AND m.created_at > now() - make_interval(days => (cfg->>'window_days')::int)), 0);
      outbound_cnt := coalesce((SELECT count(*) FROM public.messages m
        WHERE m.contact_id = _contact_id AND m.direction = 'outbound'
          AND m.created_at > now() - make_interval(days => (cfg->>'window_days')::int)), 0);
    END IF;
  END LOOP;

  RETURN score;
END;
$function$;