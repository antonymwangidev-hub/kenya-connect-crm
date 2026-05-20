create table public.revenue_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  contact_id uuid,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'KES',
  note text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_revenue_entries_business on public.revenue_entries(business_id, occurred_at desc);

alter table public.revenue_entries enable row level security;

create policy "read revenue in own business" on public.revenue_entries
  for select using (public.owns_business(business_id));
create policy "insert revenue in own business" on public.revenue_entries
  for insert with check (public.owns_business(business_id));
create policy "update revenue in own business" on public.revenue_entries
  for update using (public.owns_business(business_id));
create policy "delete revenue in own business" on public.revenue_entries
  for delete using (public.owns_business(business_id));