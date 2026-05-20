-- Pipeline stage on contacts
create type public.contact_stage as enum ('new','interested','negotiation','paid','lost');
alter table public.contacts add column stage public.contact_stage not null default 'new';

-- Automation rules
create type public.automation_trigger as enum ('new_message','tag_added','time_delay');
create type public.automation_action as enum ('send_message','add_tag','notify_owner');

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  name text not null,
  trigger public.automation_trigger not null,
  condition jsonb not null default '{}'::jsonb,
  action public.automation_action not null,
  action_payload jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.automation_rules enable row level security;
create policy "read automation_rules in own business" on public.automation_rules for select using (public.owns_business(business_id));
create policy "insert automation_rules in own business" on public.automation_rules for insert with check (public.owns_business(business_id));
create policy "update automation_rules in own business" on public.automation_rules for update using (public.owns_business(business_id));
create policy "delete automation_rules in own business" on public.automation_rules for delete using (public.owns_business(business_id));

-- Automation runs log
create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  business_id uuid not null,
  contact_id uuid,
  status text not null default 'success',
  detail text,
  created_at timestamptz not null default now()
);
alter table public.automation_runs enable row level security;
create policy "read automation_runs in own business" on public.automation_runs for select using (public.owns_business(business_id));
create policy "insert automation_runs in own business" on public.automation_runs for insert with check (public.owns_business(business_id));

-- Broadcasts
create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  name text not null,
  content text not null,
  total_recipients int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.broadcasts enable row level security;
create policy "read broadcasts in own business" on public.broadcasts for select using (public.owns_business(business_id));
create policy "insert broadcasts in own business" on public.broadcasts for insert with check (public.owns_business(business_id));
create policy "update broadcasts in own business" on public.broadcasts for update using (public.owns_business(business_id));
create policy "delete broadcasts in own business" on public.broadcasts for delete using (public.owns_business(business_id));

create table public.broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  contact_id uuid not null,
  status text not null default 'pending',
  channel text,
  error text,
  sent_at timestamptz
);
alter table public.broadcast_recipients enable row level security;
create policy "read broadcast_recipients via broadcast" on public.broadcast_recipients for select using (
  exists(select 1 from public.broadcasts b where b.id = broadcast_id and public.owns_business(b.business_id))
);
create policy "insert broadcast_recipients via broadcast" on public.broadcast_recipients for insert with check (
  exists(select 1 from public.broadcasts b where b.id = broadcast_id and public.owns_business(b.business_id))
);
create policy "update broadcast_recipients via broadcast" on public.broadcast_recipients for update using (
  exists(select 1 from public.broadcasts b where b.id = broadcast_id and public.owns_business(b.business_id))
);

create index on public.automation_rules(business_id);
create index on public.broadcasts(business_id);
create index on public.broadcast_recipients(broadcast_id);
create index on public.contacts(business_id, stage);