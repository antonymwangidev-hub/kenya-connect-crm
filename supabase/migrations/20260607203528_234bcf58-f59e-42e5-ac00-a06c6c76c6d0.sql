
CREATE TABLE public.rate_limits (
  bucket text NOT NULL,
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key, window_start)
);

GRANT ALL ON public.rate_limits TO service_role;

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- No policies: only service_role (admin client) reads/writes this table.

CREATE INDEX idx_rate_limits_window ON public.rate_limits (window_start);

-- Atomic increment + check. Returns true when the request is ALLOWED.
CREATE OR REPLACE FUNCTION public.rate_limit_check(
  _bucket text,
  _key text,
  _limit integer,
  _window_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  win timestamptz;
  new_count integer;
BEGIN
  win := date_trunc('second', now()) - (extract(epoch from now())::bigint % _window_seconds) * interval '1 second';
  INSERT INTO public.rate_limits (bucket, key, window_start, count)
  VALUES (_bucket, _key, win, 1)
  ON CONFLICT (bucket, key, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO new_count;

  -- Best-effort cleanup of old rows (1 in 100 calls)
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 hour';
  END IF;

  RETURN new_count <= _limit;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_check(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rate_limit_check(text, text, integer, integer) TO service_role;
