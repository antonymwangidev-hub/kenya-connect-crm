
-- BUSINESSES (multi-tenant root)
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.businesses enable row level security;

create policy "owner can read own business" on public.businesses
  for select using (auth.uid() = owner_id);
create policy "owner can insert own business" on public.businesses
  for insert with check (auth.uid() = owner_id);
create policy "owner can update own business" on public.businesses
  for update using (auth.uid() = owner_id);
create policy "owner can delete own business" on public.businesses
  for delete using (auth.uid() = owner_id);

-- Helper: check business ownership (security definer, avoids recursion)
create or replace function public.owns_business(_business_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.businesses where id = _business_id and owner_id = auth.uid())
$$;

-- CONTACTS
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  phone text not null,
  created_at timestamptz not null default now()
);
create index on public.contacts(business_id);
alter table public.contacts enable row level security;

create policy "read contacts in own business" on public.contacts
  for select using (public.owns_business(business_id));
create policy "insert contacts in own business" on public.contacts
  for insert with check (public.owns_business(business_id));
create policy "update contacts in own business" on public.contacts
  for update using (public.owns_business(business_id));
create policy "delete contacts in own business" on public.contacts
  for delete using (public.owns_business(business_id));

-- MESSAGES
create type public.message_direction as enum ('inbound','outbound');

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  direction public.message_direction not null,
  content text not null,
  created_at timestamptz not null default now()
);
create index on public.messages(contact_id, created_at);
alter table public.messages enable row level security;

create or replace function public.owns_contact(_contact_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.contacts c
    join public.businesses b on b.id = c.business_id
    where c.id = _contact_id and b.owner_id = auth.uid()
  )
$$;

create policy "read messages of own contacts" on public.messages
  for select using (public.owns_contact(contact_id));
create policy "insert messages of own contacts" on public.messages
  for insert with check (public.owns_contact(contact_id));
create policy "delete messages of own contacts" on public.messages
  for delete using (public.owns_contact(contact_id));

-- TAGS (scoped to business)
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);
alter table public.tags enable row level security;

create policy "read tags in own business" on public.tags
  for select using (public.owns_business(business_id));
create policy "insert tags in own business" on public.tags
  for insert with check (public.owns_business(business_id));
create policy "update tags in own business" on public.tags
  for update using (public.owns_business(business_id));
create policy "delete tags in own business" on public.tags
  for delete using (public.owns_business(business_id));

-- CONTACT_TAGS
create table public.contact_tags (
  contact_id uuid not null references public.contacts(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (contact_id, tag_id)
);
alter table public.contact_tags enable row level security;

create policy "read contact_tags of own contacts" on public.contact_tags
  for select using (public.owns_contact(contact_id));
create policy "insert contact_tags of own contacts" on public.contact_tags
  for insert with check (public.owns_contact(contact_id));
create policy "delete contact_tags of own contacts" on public.contact_tags
  for delete using (public.owns_contact(contact_id));

-- Auto-create a default business on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.businesses (owner_id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'business_name', 'My Business'));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Realtime for messages
alter publication supabase_realtime add table public.messages;
