
-- Tighten virtual_numbers policies (marketplace listing/reservation will use service role)
DROP POLICY IF EXISTS "read own virtual_numbers" ON public.virtual_numbers;
DROP POLICY IF EXISTS "insert virtual_numbers in own business" ON public.virtual_numbers;
DROP POLICY IF EXISTS "update virtual_numbers in own business" ON public.virtual_numbers;

CREATE POLICY "read own virtual_numbers"
  ON public.virtual_numbers FOR SELECT
  USING (owns_business(business_id));

CREATE POLICY "insert virtual_numbers in own business"
  ON public.virtual_numbers FOR INSERT
  WITH CHECK (owns_business(business_id));

CREATE POLICY "update virtual_numbers in own business"
  ON public.virtual_numbers FOR UPDATE
  USING (owns_business(business_id))
  WITH CHECK (owns_business(business_id));

CREATE POLICY "delete virtual_numbers in own business"
  ON public.virtual_numbers FOR DELETE
  USING (owns_business(business_id));

-- Automation runs: allow owners to delete their history
CREATE POLICY "delete automation_runs in own business"
  ON public.automation_runs FOR DELETE
  USING (owns_business(business_id));
