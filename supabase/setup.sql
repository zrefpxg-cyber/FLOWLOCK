create table if not exists public.flowlock_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (char_length(username) between 3 and 128),
  uid text not null unique default (
    'FLOW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  avatar_path text,
  created_at timestamptz not null default now()
);

alter table public.flowlock_profiles
  add column if not exists avatar_path text;

create unique index if not exists flowlock_profiles_username_lower_key
  on public.flowlock_profiles (lower(username));

alter table public.flowlock_profiles enable row level security;
revoke all on table public.flowlock_profiles from anon, public;
grant select on table public.flowlock_profiles to authenticated;
grant update (avatar_path) on table public.flowlock_profiles to authenticated;

drop policy if exists "Members can read their own profile" on public.flowlock_profiles;
create policy "Members can read their own profile"
  on public.flowlock_profiles for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Members can update their own avatar path" on public.flowlock_profiles;
create policy "Members can update their own avatar path"
  on public.flowlock_profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function public.flowlock_create_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.flowlock_profiles (id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
end;
$$;

drop trigger if exists flowlock_auth_user_created on auth.users;
create trigger flowlock_auth_user_created
  after insert on auth.users
  for each row execute procedure public.flowlock_create_profile();

create or replace function public.get_flowlock_user_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from public.flowlock_profiles;
$$;

revoke all on function public.get_flowlock_user_count() from public;
grant execute on function public.get_flowlock_user_count() to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'flowlock-avatars',
  'flowlock-avatars',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Members manage their own avatar files" on storage.objects;
create policy "Members manage their own avatar files"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'flowlock-avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'flowlock-avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

notify pgrst, 'reload schema';
