
-- WhatsApp connections
CREATE TABLE public.whatsapp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  phone_number text NOT NULL,
  phone_number_id text,
  waba_id text,
  display_name text,
  status text NOT NULL DEFAULT 'pending',
  quality_rating text,
  connected_at timestamptz,
  disconnected_at timestamptz,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read whatsapp_connections in own business" ON public.whatsapp_connections FOR SELECT USING (owns_business(business_id));
CREATE POLICY "insert whatsapp_connections in own business" ON public.whatsapp_connections FOR INSERT WITH CHECK (owns_business(business_id));
CREATE POLICY "update whatsapp_connections in own business" ON public.whatsapp_connections FOR UPDATE USING (owns_business(business_id));
CREATE POLICY "delete whatsapp_connections in own business" ON public.whatsapp_connections FOR DELETE USING (owns_business(business_id));
CREATE INDEX idx_whatsapp_connections_business ON public.whatsapp_connections(business_id);
CREATE UNIQUE INDEX idx_whatsapp_connections_phone_number_id ON public.whatsapp_connections(phone_number_id) WHERE phone_number_id IS NOT NULL;

-- Business verifications
CREATE TABLE public.business_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL UNIQUE,
  legal_name text,
  certificate_url text,
  owner_id_url text,
  suggested_display_name text,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.business_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read business_verifications in own business" ON public.business_verifications FOR SELECT USING (owns_business(business_id));
CREATE POLICY "insert business_verifications in own business" ON public.business_verifications FOR INSERT WITH CHECK (owns_business(business_id));
CREATE POLICY "update business_verifications in own business" ON public.business_verifications FOR UPDATE USING (owns_business(business_id));
CREATE POLICY "delete business_verifications in own business" ON public.business_verifications FOR DELETE USING (owns_business(business_id));

-- Virtual numbers
CREATE TABLE public.virtual_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid,
  phone_number text NOT NULL UNIQUE,
  provider text NOT NULL DEFAULT 'africastalking',
  provider_sub_account text,
  status text NOT NULL DEFAULT 'available',
  price_kes numeric NOT NULL DEFAULT 550,
  purchased_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.virtual_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own virtual_numbers" ON public.virtual_numbers FOR SELECT USING (business_id IS NULL OR owns_business(business_id));
CREATE POLICY "insert virtual_numbers in own business" ON public.virtual_numbers FOR INSERT WITH CHECK (business_id IS NULL OR owns_business(business_id));
CREATE POLICY "update virtual_numbers in own business" ON public.virtual_numbers FOR UPDATE USING (business_id IS NULL OR owns_business(business_id));

-- Payment transactions
CREATE TABLE public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  provider text NOT NULL,
  provider_ref text,
  purpose text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read payment_transactions in own business" ON public.payment_transactions FOR SELECT USING (owns_business(business_id));
CREATE POLICY "insert payment_transactions in own business" ON public.payment_transactions FOR INSERT WITH CHECK (owns_business(business_id));
CREATE POLICY "update payment_transactions in own business" ON public.payment_transactions FOR UPDATE USING (owns_business(business_id));

-- Onboarding sessions
CREATE TABLE public.onboarding_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL UNIQUE,
  step text NOT NULL DEFAULT 'profile',
  path text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.onboarding_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read onboarding_sessions in own business" ON public.onboarding_sessions FOR SELECT USING (owns_business(business_id));
CREATE POLICY "insert onboarding_sessions in own business" ON public.onboarding_sessions FOR INSERT WITH CHECK (owns_business(business_id));
CREATE POLICY "update onboarding_sessions in own business" ON public.onboarding_sessions FOR UPDATE USING (owns_business(business_id));

-- Webhook logs
CREATE TABLE public.webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid,
  source text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature_ok boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read webhook_logs in own business" ON public.webhook_logs FOR SELECT USING (business_id IS NOT NULL AND owns_business(business_id));
CREATE INDEX idx_webhook_logs_business ON public.webhook_logs(business_id, created_at DESC);

-- Message delivery logs
CREATE TABLE public.message_delivery_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  status text NOT NULL,
  provider_status text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.message_delivery_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read message_delivery_logs via own messages" ON public.message_delivery_logs FOR SELECT USING (
  EXISTS(SELECT 1 FROM public.messages m WHERE m.id = message_id AND owns_contact(m.contact_id))
);
CREATE INDEX idx_message_delivery_logs_message ON public.message_delivery_logs(message_id);

-- updated_at trigger function (idempotent)
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER t_whatsapp_connections_updated BEFORE UPDATE ON public.whatsapp_connections FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_business_verifications_updated BEFORE UPDATE ON public.business_verifications FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_virtual_numbers_updated BEFORE UPDATE ON public.virtual_numbers FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_payment_transactions_updated BEFORE UPDATE ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_onboarding_sessions_updated BEFORE UPDATE ON public.onboarding_sessions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed a small pool of demo virtual numbers (idempotent on phone_number)
INSERT INTO public.virtual_numbers (phone_number, provider, status, price_kes)
VALUES
 ('+254700111222', 'africastalking', 'available', 550),
 ('+254700333444', 'africastalking', 'available', 550),
 ('+254700555666', 'africastalking', 'available', 550),
 ('+254700777888', 'africastalking', 'available', 550),
 ('+254700999000', 'africastalking', 'available', 550)
ON CONFLICT (phone_number) DO NOTHING;
