-- 1. Columns on contacts
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS lead_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_score_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_contacts_business_lead_score
  ON public.contacts (business_id, lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_messages_contact_created
  ON public.messages (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revenue_entries_contact
  ON public.revenue_entries (contact_id);

-- 2. Score history
CREATE TABLE IF NOT EXISTS public.lead_score_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  old_score numeric NOT NULL DEFAULT 0,
  new_score numeric NOT NULL DEFAULT 0,
  reason text,
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_score_history_contact
  ON public.lead_score_history (contact_id, created_at DESC);

GRANT SELECT ON public.lead_score_history TO authenticated;
GRANT ALL ON public.lead_score_history TO service_role;
ALTER TABLE public.lead_score_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read score history" ON public.lead_score_history
  FOR SELECT TO authenticated USING (public.is_business_member(business_id));

-- 3. Scoring rules
CREATE TABLE IF NOT EXISTS public.scoring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  weight numeric NOT NULL DEFAULT 1,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scoring_rules TO authenticated;
GRANT ALL ON public.scoring_rules TO service_role;
ALTER TABLE public.scoring_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read scoring rules" ON public.scoring_rules
  FOR SELECT TO authenticated USING (public.is_business_member(business_id));
CREATE POLICY "writers insert scoring rules" ON public.scoring_rules
  FOR INSERT TO authenticated WITH CHECK (public.can_write_business(business_id));
CREATE POLICY "writers update scoring rules" ON public.scoring_rules
  FOR UPDATE TO authenticated USING (public.can_write_business(business_id))
  WITH CHECK (public.can_write_business(business_id));
CREATE POLICY "writers delete scoring rules" ON public.scoring_rules
  FOR DELETE TO authenticated USING (public.can_write_business(business_id));

CREATE TRIGGER scoring_rules_touch BEFORE UPDATE ON public.scoring_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. Default rules seeding
CREATE OR REPLACE FUNCTION public.ensure_default_scoring_rules(_business_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_default_scoring_rules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_default_scoring_rules(uuid) TO authenticated, service_role;

-- 5. Scoring engine
CREATE OR REPLACE FUNCTION public.recalc_lead_score(_contact_id uuid, _reason text DEFAULT 'manual')
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  PERFORM public.ensure_default_scoring_rules(biz);

  -- stage
  SELECT weight, config INTO w, cfg FROM public.scoring_rules
   WHERE business_id = biz AND key = 'stage' AND is_active;
  IF w IS NOT NULL THEN
    part := w * coalesce((cfg ->> c_stage)::numeric, 0);
    score := score + part;
    parts := parts || jsonb_build_object('stage', part);
  END IF;

  -- inbound activity
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

  -- outbound engagement
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

  -- revenue
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

  -- recency
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

  -- dormant penalty (multiplier)
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

  RETURN score;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recalc_lead_score(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalc_lead_score(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.recalc_business_lead_scores(_business_id uuid, _reason text DEFAULT 'batch')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r record; n int := 0;
BEGIN
  IF NOT public.is_business_member(_business_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  FOR r IN SELECT id FROM public.contacts WHERE business_id = _business_id LOOP
    PERFORM public.recalc_lead_score(r.id, _reason);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recalc_business_lead_scores(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalc_business_lead_scores(uuid, text) TO authenticated, service_role;

-- nightly full refresh helper (service role / cron only)
CREATE OR REPLACE FUNCTION public.recalc_all_lead_scores()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT id FROM public.contacts LOOP
    PERFORM public.recalc_lead_score(r.id, 'nightly');
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recalc_all_lead_scores() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_all_lead_scores() TO service_role;

-- 6. Event triggers
CREATE OR REPLACE FUNCTION public.trg_score_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.recalc_lead_score(NEW.contact_id, 'message_' || NEW.direction::text);
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_score_on_message() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS score_on_message ON public.messages;
CREATE TRIGGER score_on_message AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_score_on_message();

CREATE OR REPLACE FUNCTION public.trg_score_on_contact_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.recalc_lead_score(NEW.id, 'stage_change');
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_score_on_contact_stage() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS score_on_contact_stage ON public.contacts;
CREATE TRIGGER score_on_contact_stage AFTER UPDATE OF stage ON public.contacts
  FOR EACH ROW WHEN (OLD.stage IS DISTINCT FROM NEW.stage)
  EXECUTE FUNCTION public.trg_score_on_contact_stage();

-- 7. Nightly cron
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule('nightly-lead-scores') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nightly-lead-scores');
SELECT cron.schedule('nightly-lead-scores', '30 1 * * *', $$SELECT public.recalc_all_lead_scores();$$);