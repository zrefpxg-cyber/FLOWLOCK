create table if not exists public.flowlock_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (char_length(username) between 3 and 128),
  uid text not null unique default (
    'FLOW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  avatar_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.flowlock_friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.flowlock_profiles (id) on delete cascade,
  receiver_id uuid not null references public.flowlock_profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint flowlock_friend_requests_not_self check (sender_id <> receiver_id),
  constraint flowlock_friend_requests_unique_pair unique (sender_id, receiver_id)
);

create table if not exists public.flowlock_friendships (
  user_low uuid not null references public.flowlock_profiles (id) on delete cascade,
  user_high uuid not null references public.flowlock_profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  constraint flowlock_friendships_ordered_pair check (user_low < user_high)
);

create table if not exists public.flowlock_shared_rooms (
  id text primary key check (char_length(id) between 1 and 100),
  kind text not null check (kind in ('game', 'trade')),
  owner_id uuid not null references public.flowlock_profiles (id) on delete cascade,
  participant_ids uuid[] not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.flowlock_game_text_entries (
  room_id text not null references public.flowlock_shared_rooms (id) on delete cascade,
  user_id uuid not null references public.flowlock_profiles (id) on delete cascade,
  entry text not null check (char_length(entry) between 1 and 500),
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists flowlock_shared_rooms_participant_ids_idx
  on public.flowlock_shared_rooms using gin (participant_ids);

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

create or replace function public.find_flowlock_profile(search_value text)
returns table (username text, uid text)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.username, profile.uid
  from public.flowlock_profiles as profile
  where (select auth.uid()) is not null
    and (
      lower(profile.username) = lower(trim(search_value))
      or upper(profile.uid) = upper(trim(search_value))
    )
  limit 1;
$$;

revoke all on function public.find_flowlock_profile(text) from public, anon;
grant execute on function public.find_flowlock_profile(text) to authenticated;

create or replace function public.send_flowlock_friend_request(target_value text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_id uuid := auth.uid();
  target_id uuid;
begin
  if current_id is null or nullif(trim(target_value), '') is null then
    return 'not_found';
  end if;

  select profile.id
  into target_id
  from public.flowlock_profiles as profile
  where lower(profile.username) = lower(trim(target_value))
    or upper(profile.uid) = upper(trim(target_value))
  limit 1;

  if target_id is null then
    return 'not_found';
  end if;
  if target_id = current_id then
    return 'self';
  end if;
  if exists (
    select 1
    from public.flowlock_friendships as friendship
    where friendship.user_low = least(current_id, target_id)
      and friendship.user_high = greatest(current_id, target_id)
  ) then
    return 'already_friend';
  end if;
  if exists (
    select 1
    from public.flowlock_friend_requests as request
    where request.sender_id = current_id
      and request.receiver_id = target_id
  ) then
    return 'already_sent';
  end if;
  if exists (
    select 1
    from public.flowlock_friend_requests as request
    where request.sender_id = target_id
      and request.receiver_id = current_id
  ) then
    return 'incoming_pending';
  end if;

  insert into public.flowlock_friend_requests (sender_id, receiver_id)
  values (current_id, target_id);
  return 'sent';
end;
$$;

create or replace function public.get_flowlock_friends()
returns table (id uuid, username text, uid text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, profile.username, profile.uid, friendship.created_at
  from public.flowlock_friendships as friendship
  join public.flowlock_profiles as profile
    on profile.id = case
      when friendship.user_low = (select auth.uid()) then friendship.user_high
      else friendship.user_low
    end
  where (select auth.uid()) in (friendship.user_low, friendship.user_high)
  order by profile.username;
$$;

create or replace function public.get_flowlock_friend_requests()
returns table (
  request_id uuid,
  direction text,
  friend_id uuid,
  username text,
  uid text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select request.id,
         case when request.receiver_id = (select auth.uid()) then 'incoming' else 'outgoing' end,
         profile.id,
         profile.username,
         profile.uid,
         request.created_at
  from public.flowlock_friend_requests as request
  join public.flowlock_profiles as profile
    on profile.id = case
      when request.receiver_id = (select auth.uid()) then request.sender_id
      else request.receiver_id
    end
  where request.sender_id = (select auth.uid())
     or request.receiver_id = (select auth.uid())
  order by request.created_at desc;
$$;

create or replace function public.respond_flowlock_friend_request(request_id uuid, accept_request boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.flowlock_friend_requests%rowtype;
begin
  if auth.uid() is null then
    return false;
  end if;

  select request.*
  into request_row
  from public.flowlock_friend_requests as request
  where request.id = request_id
    and (
      request.receiver_id = auth.uid()
      or (not accept_request and request.sender_id = auth.uid())
    )
  for update;

  if not found then
    return false;
  end if;

  if accept_request then
    if request_row.receiver_id <> auth.uid() then
      return false;
    end if;
    insert into public.flowlock_friendships (user_low, user_high)
    values (
      least(request_row.sender_id, request_row.receiver_id),
      greatest(request_row.sender_id, request_row.receiver_id)
    )
    on conflict do nothing;
    delete from public.flowlock_friend_requests as pending_request
    where (pending_request.sender_id = request_row.sender_id
           and pending_request.receiver_id = request_row.receiver_id)
       or (pending_request.sender_id = request_row.receiver_id
           and pending_request.receiver_id = request_row.sender_id);
    return true;
  end if;

  delete from public.flowlock_friend_requests as request
  where request.id = request_row.id;
  return true;
end;
$$;

create or replace function public.remove_flowlock_friend(friend_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or friend_id = auth.uid() then
    return false;
  end if;

  delete from public.flowlock_friendships as friendship
  where friendship.user_low = least(auth.uid(), friend_id)
    and friendship.user_high = greatest(auth.uid(), friend_id);
  return found;
end;
$$;

create or replace function public.submit_flowlock_game_text(room_code text, entry_text text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_row public.flowlock_shared_rooms%rowtype;
  cleaned_entry text := trim(entry_text);
begin
  if auth.uid() is null or cleaned_entry is null
     or char_length(cleaned_entry) not between 1 and 500
     or cleaned_entry ~* '(https?://|www\.)' then
    return false;
  end if;

  select room.*
  into room_row
  from public.flowlock_shared_rooms as room
  where room.id = 'game-' || trim(room_code)
    and room.kind = 'game'
  for update;

  if not found then
    return false;
  end if;
  if room_row.payload ->> 'mode' is distinct from 'text'
     or room_row.payload ->> 'status' is distinct from 'lobby'
     or not coalesce(room_row.payload -> 'memberIds' ? auth.uid()::text, false) then
    return false;
  end if;

  insert into public.flowlock_game_text_entries (room_id, user_id, entry)
  values (room_row.id, auth.uid(), cleaned_entry)
  on conflict (room_id, user_id)
  do update set entry = excluded.entry, created_at = now();
  return true;
end;
$$;

create or replace function public.get_flowlock_game_text_status(room_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  room_row public.flowlock_shared_rooms%rowtype;
  submitted_total bigint;
  own_entry text;
  winner_index integer;
  winner_id text;
  revealed_entries jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;

  select room.*
  into room_row
  from public.flowlock_shared_rooms as room
  where room.id = 'game-' || trim(room_code)
    and room.kind = 'game';

  if not found or not coalesce(room_row.payload -> 'memberIds' ? auth.uid()::text, false) then
    return null;
  end if;

  select count(*)
  into submitted_total
  from public.flowlock_game_text_entries as message
  where message.room_id = room_row.id;

  select message.entry
  into own_entry
  from public.flowlock_game_text_entries as message
  where message.room_id = room_row.id
    and message.user_id = auth.uid();

  if room_row.payload ->> 'status' = 'finished' then
    winner_index := nullif(room_row.payload -> 'state' ->> 'winner', '')::integer;
    if winner_index is not null then
      winner_id := room_row.payload -> 'memberIds' ->> winner_index;
    end if;

    if winner_id = auth.uid()::text then
      select coalesce(
        jsonb_agg(
          jsonb_build_object('name', profile.username, 'text', message.entry)
          order by message.created_at
        ),
        '[]'::jsonb
      )
      into revealed_entries
      from public.flowlock_game_text_entries as message
      join public.flowlock_profiles as profile on profile.id = message.user_id
      where message.room_id = room_row.id;
    end if;
  end if;

  return jsonb_build_object(
    'submitted_count', submitted_total,
    'own_entry', coalesce(own_entry, ''),
    'revealed_entries', revealed_entries
  );
end;
$$;

create or replace function public.decline_flowlock_game_invite(room_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_row public.flowlock_shared_rooms%rowtype;
  remaining_invited_ids jsonb;
  remaining_invited_names jsonb;
begin
  if auth.uid() is null then
    return false;
  end if;

  select room.*
  into room_row
  from public.flowlock_shared_rooms as room
  where room.id = 'game-' || trim(room_code)
    and room.kind = 'game'
  for update;

  if not found
     or room_row.payload ->> 'status' is distinct from 'lobby'
     or not coalesce(room_row.payload -> 'invitedIds' ? auth.uid()::text, false)
     or coalesce(room_row.payload -> 'memberIds' ? auth.uid()::text, false) then
    return false;
  end if;

  select coalesce(jsonb_agg(to_jsonb(invitation.value) order by invitation.ordinality), '[]'::jsonb)
  into remaining_invited_ids
  from jsonb_array_elements_text(coalesce(room_row.payload -> 'invitedIds', '[]'::jsonb))
    with ordinality as invitation(value, ordinality)
  where invitation.value <> auth.uid()::text;

  select coalesce(jsonb_agg(to_jsonb(invitation_name.value) order by invitation_name.ordinality), '[]'::jsonb)
  into remaining_invited_names
  from jsonb_array_elements_text(coalesce(room_row.payload -> 'invited', '[]'::jsonb))
    with ordinality as invitation_name(value, ordinality)
  join jsonb_array_elements_text(coalesce(room_row.payload -> 'invitedIds', '[]'::jsonb))
    with ordinality as invited_id(value, ordinality)
    using (ordinality)
  where invited_id.value <> auth.uid()::text;

  update public.flowlock_shared_rooms
  set participant_ids = array_remove(participant_ids, auth.uid()),
      payload = jsonb_set(
        jsonb_set(payload, '{invitedIds}', remaining_invited_ids, true),
        '{invited}',
        remaining_invited_names,
        true
      ),
      updated_at = now()
  where id = room_row.id;
  return found;
end;
$$;

revoke all on function public.send_flowlock_friend_request(text) from public, anon;
revoke all on function public.get_flowlock_friends() from public, anon;
revoke all on function public.get_flowlock_friend_requests() from public, anon;
revoke all on function public.respond_flowlock_friend_request(uuid, boolean) from public, anon;
revoke all on function public.remove_flowlock_friend(uuid) from public, anon;
revoke all on function public.submit_flowlock_game_text(text, text) from public, anon;
revoke all on function public.get_flowlock_game_text_status(text) from public, anon;
revoke all on function public.decline_flowlock_game_invite(text) from public, anon;
grant execute on function public.send_flowlock_friend_request(text) to authenticated;
grant execute on function public.get_flowlock_friends() to authenticated;
grant execute on function public.get_flowlock_friend_requests() to authenticated;
grant execute on function public.respond_flowlock_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_flowlock_friend(uuid) to authenticated;
grant execute on function public.submit_flowlock_game_text(text, text) to authenticated;
grant execute on function public.get_flowlock_game_text_status(text) to authenticated;
grant execute on function public.decline_flowlock_game_invite(text) to authenticated;

alter table public.flowlock_friend_requests enable row level security;
alter table public.flowlock_friendships enable row level security;
revoke all on table public.flowlock_friend_requests, public.flowlock_friendships from anon, authenticated, public;

alter table public.flowlock_game_text_entries enable row level security;
revoke all on table public.flowlock_game_text_entries from anon, authenticated, public;

alter table public.flowlock_shared_rooms enable row level security;
revoke all on table public.flowlock_shared_rooms from anon, authenticated, public;
grant select on table public.flowlock_shared_rooms to authenticated;
grant insert (id, kind, owner_id, participant_ids, payload) on table public.flowlock_shared_rooms to authenticated;
grant update (participant_ids, payload, updated_at) on table public.flowlock_shared_rooms to authenticated;

drop policy if exists "Participants can read shared rooms" on public.flowlock_shared_rooms;
create policy "Participants can read shared rooms"
  on public.flowlock_shared_rooms for select
  to authenticated
  using (
    (select auth.uid()) = any(participant_ids)
    or (
      kind = 'game'
      and payload ->> 'visibility' = 'public'
      and payload ->> 'status' = 'lobby'
    )
  );

drop policy if exists "Room owners can create shared rooms" on public.flowlock_shared_rooms;
create policy "Room owners can create shared rooms"
  on public.flowlock_shared_rooms for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select auth.uid()) = any(participant_ids)
  );

drop policy if exists "Participants can update shared rooms" on public.flowlock_shared_rooms;
create policy "Participants can update shared rooms"
  on public.flowlock_shared_rooms for update
  to authenticated
  using (
    (select auth.uid()) = any(participant_ids)
    or (
      kind = 'game'
      and payload ->> 'visibility' = 'public'
      and payload ->> 'status' = 'lobby'
    )
  )
  with check ((select auth.uid()) = any(participant_ids));

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
