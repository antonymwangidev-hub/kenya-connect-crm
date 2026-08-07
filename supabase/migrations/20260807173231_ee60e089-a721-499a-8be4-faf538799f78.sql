CREATE OR REPLACE FUNCTION public.business_performance_metrics(_business_id uuid)
RETURNS TABLE (
  contacts_total bigint,
  contacts_paid bigint,
  avg_response_minutes numeric,
  response_pairs bigint,
  revenue_total numeric,
  revenue_entries_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_business_member(_business_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH c AS (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE stage = 'paid') AS paid
    FROM public.contacts WHERE business_id = _business_id
  ),
  paired AS (
    SELECT m.created_at AS inbound_at,
           lead(m.created_at) OVER (PARTITION BY m.contact_id ORDER BY m.created_at) AS next_at,
           m.direction,
           lead(m.direction) OVER (PARTITION BY m.contact_id ORDER BY m.created_at) AS next_direction
    FROM public.messages m
    JOIN public.contacts ct ON ct.id = m.contact_id
    WHERE ct.business_id = _business_id
  ),
  r AS (
    SELECT coalesce(sum(amount), 0) AS total, count(*) AS cnt
    FROM public.revenue_entries WHERE business_id = _business_id
  ),
  resp AS (
    SELECT count(*) AS pairs,
           avg(extract(epoch FROM (next_at - inbound_at)) / 60.0) AS avg_min
    FROM paired
    WHERE direction = 'inbound' AND next_direction = 'outbound'
  )
  SELECT c.total, c.paid,
         round(coalesce(resp.avg_min, 0)::numeric, 1),
         resp.pairs,
         r.total, r.cnt
  FROM c, resp, r;
END;
$$;

GRANT EXECUTE ON FUNCTION public.business_performance_metrics(uuid) TO authenticated;