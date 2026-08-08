-- ============ Routing rules ============
CREATE TABLE public.routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  min_score numeric NOT NULL DEFAULT 0,
  max_score numeric NOT NULL DEFAULT 100,
  stages text[] NOT NULL DEFAULT '{}',
  assign_strategy text NOT NULL DEFAULT 'round_robin',
  assign_to_user_id uuid,
  team text,
  create_task boolean NOT NULL DEFAULT false,
  task_hours integer NOT NULL DEFAULT 4,
  task_note text,
  send_message boolean NOT NULL DEFAULT false,
  message_body text,
  priority integer NOT NULL DEFAULT 100,
  dry_run boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT routing_rules_strategy_chk CHECK (assign_strategy IN ('fixed','round_robin','none'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routing_rules TO authenticated;
GRANT ALL ON public.routing_rules TO service_role;
ALTER TABLE public.routing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read routing rules" ON public.routing_rules FOR SELECT TO authenticated USING (public.is_business_member(business_id));
CREATE POLICY "writers insert routing rules" ON public.routing_rules FOR INSERT TO authenticated WITH CHECK (public.can_write_business(business_id));
CREATE POLICY "writers update routing rules" ON public.routing_rules FOR UPDATE TO authenticated USING (public.can_write_business(business_id)) WITH CHECK (public.can_write_business(business_id));
CREATE POLICY "writers delete routing rules" ON public.routing_rules FOR DELETE TO authenticated USING (public.can_write_business(business_id));
CREATE TRIGGER routing_rules_touch BEFORE UPDATE ON public.routing_rules FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX routing_rules_biz_idx ON public.routing_rules (business_id, is_active, priority);

-- ============ Lead assignments ============
CREATE TABLE public.lead_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  assignee_id uuid,
  rule_id uuid REFERENCES public.routing_rules(id) ON DELETE SET NULL,
  reason text,
  score numeric,
  dry_run boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.lead_assignments TO authenticated;
GRANT ALL ON public.lead_assignments TO service_role;
ALTER TABLE public.lead_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read lead assignments" ON public.lead_assignments FOR SELECT TO authenticated USING (public.is_business_member(business_id));
CREATE INDEX lead_assignments_contact_idx ON public.lead_assignments (contact_id, created_at DESC);

-- ============ Routing action queue (idempotent) ============
CREATE TABLE public.routing_action_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.routing_rules(id) ON DELETE SET NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  detail text,
  dedupe_key text NOT NULL UNIQUE,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.routing_action_runs TO authenticated;
GRANT ALL ON public.routing_action_runs TO service_role;
ALTER TABLE public.routing_action_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read routing runs" ON public.routing_action_runs FOR SELECT TO authenticated USING (public.is_business_member(business_id));
CREATE INDEX routing_action_runs_pending_idx ON public.routing_action_runs (status, scheduled_at);

-- ============ Routing engine ============
CREATE OR REPLACE FUNCTION public.route_lead(_contact_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c record;
  r record;
  assignee uuid;
  conv_id uuid;
  current_assignee uuid;
  key text;
BEGIN
  SELECT id, business_id, stage::text, coalesce(lead_score,0) AS score, name
    INTO c FROM public.contacts WHERE id = _contact_id;
  IF c.id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO r FROM public.routing_rules
   WHERE business_id = c.business_id AND is_active
     AND c.score >= min_score AND c.score <= max_score
     AND (cardinality(stages) = 0 OR c.stage = ANY (stages))
   ORDER BY priority ASC, created_at ASC
   LIMIT 1;
  IF r.id IS NULL THEN RETURN NULL; END IF;

  SELECT id, assigned_to INTO conv_id, current_assignee
    FROM public.conversations WHERE contact_id = _contact_id LIMIT 1;

  -- pick assignee
  IF r.assign_strategy = 'fixed' THEN
    assignee := r.assign_to_user_id;
  ELSIF r.assign_strategy = 'round_robin' THEN
    SELECT m.user_id INTO assignee
      FROM public.business_members m
      LEFT JOIN public.conversations cv
        ON cv.assigned_to = m.user_id AND cv.business_id = c.business_id AND cv.status <> 'resolved'
     WHERE m.business_id = c.business_id AND m.user_id IS NOT NULL AND m.role IN ('admin','agent')
     GROUP BY m.user_id
     ORDER BY count(cv.id) ASC, m.user_id
     LIMIT 1;
    IF assignee IS NULL THEN
      SELECT owner_id INTO assignee FROM public.businesses WHERE id = c.business_id;
    END IF;
  END IF;

  -- already assigned to this person by this rule? nothing to do
  IF current_assignee IS NOT NULL AND current_assignee = assignee THEN
    RETURN assignee;
  END IF;

  IF assignee IS NOT NULL AND current_assignee IS DISTINCT FROM assignee THEN
    INSERT INTO public.lead_assignments (business_id, contact_id, assignee_id, rule_id, reason, score, dry_run)
    VALUES (c.business_id, _contact_id, assignee, r.id,
            CASE WHEN r.dry_run THEN 'dry-run: ' ELSE '' END || r.name || ' (score ' || round(c.score,1) || ')',
            c.score, r.dry_run);

    IF NOT r.dry_run AND conv_id IS NOT NULL THEN
      UPDATE public.conversations
         SET assigned_to = assignee, assigned_at = now(), team = coalesce(r.team, team)
       WHERE id = conv_id;
    END IF;
  END IF;

  -- follow-up task
  IF r.create_task THEN
    key := 'task:' || r.id::text || ':' || _contact_id::text || ':' || to_char(date_trunc('hour', now()), 'YYYYMMDDHH24');
    IF NOT r.dry_run THEN
      BEGIN
        INSERT INTO public.reminders (business_id, contact_id, due_at, note, created_by)
        VALUES (c.business_id, _contact_id, now() + (greatest(r.task_hours,1) || ' hours')::interval,
                coalesce(r.task_note, 'Follow up with ' || c.name), coalesce(assignee, (SELECT owner_id FROM public.businesses WHERE id = c.business_id)));
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
    INSERT INTO public.routing_action_runs (business_id, contact_id, rule_id, action, status, dedupe_key, detail)
    VALUES (c.business_id, _contact_id, r.id, 'create_task',
            CASE WHEN r.dry_run THEN 'dry_run' ELSE 'done' END, key, r.task_note)
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  -- outreach message queued for the worker
  IF r.send_message AND coalesce(r.message_body,'') <> '' THEN
    key := 'msg:' || r.id::text || ':' || _contact_id::text || ':' || to_char(date_trunc('day', now()), 'YYYYMMDD');
    INSERT INTO public.routing_action_runs (business_id, contact_id, rule_id, action, payload, status, dedupe_key)
    VALUES (c.business_id, _contact_id, r.id, 'send_message',
            jsonb_build_object('body', r.message_body),
            CASE WHEN r.dry_run THEN 'dry_run' ELSE 'pending' END, key)
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  RETURN assignee;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.route_lead(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.route_lead(uuid) TO authenticated, service_role;

-- hook routing into the existing scoring engine
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
