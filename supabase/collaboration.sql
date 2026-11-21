create table if not exists public.flowlock_friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  constraint flowlock_friend_requests_not_self check (sender_id <> recipient_id),
  constraint flowlock_friend_requests_sender_recipient_key unique (sender_id, recipient_id)
);

create table if not exists public.flowlock_friendships (
  user_low uuid not null references auth.users (id) on delete cascade,
  user_high uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  constraint flowlock_friendships_ordered check (user_low < user_high)
);

create table if not exists public.flowlock_game_rooms (
  code text primary key check (code ~ '^[0-9]{6}$'),
  game text not null check (game in ('snakes', 'checkers', 'property')),
  mode text not null check (mode in ('normal', 'text')),
  capacity integer not null check (capacity between 2 and 4),
  host_id uuid not null references auth.users (id) on delete cascade,
  member_ids uuid[] not null default '{}',
  invited_ids uuid[] not null default '{}',
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  state jsonb,
  text_entries jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.flowlock_trade_rooms (
  id text primary key,
  host_id uuid not null references auth.users (id) on delete cascade,
  guest_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'joined', 'trading', 'closed')),
  host_ready boolean not null default false,
  guest_ready boolean not null default false,
  created_at timestamptz not null default now(),
  constraint flowlock_trade_rooms_not_self check (host_id <> guest_id)
);

create table if not exists public.flowlock_trade_items (
  id text primary key,
  room_id text not null references public.flowlock_trade_rooms (id) on delete cascade,
  from_id uuid not null references auth.users (id) on delete cascade,
  to_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('offer', 'want')),
  category text not null,
  details text not null check (char_length(details) between 1 and 500),
  confirmed_by uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.flowlock_friend_requests enable row level security;
alter table public.flowlock_friendships enable row level security;
alter table public.flowlock_game_rooms enable row level security;
alter table public.flowlock_trade_rooms enable row level security;
alter table public.flowlock_trade_items enable row level security;

revoke all on table public.flowlock_friend_requests, public.flowlock_friendships,
  public.flowlock_game_rooms, public.flowlock_trade_rooms, public.flowlock_trade_items
  from anon, authenticated, public;

create or replace function public.lookup_flowlock_profile(search_value text)
returns table (user_id uuid, username text, uid text)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, profile.username, profile.uid
  from public.flowlock_profiles as profile
  where (select auth.uid()) is not null
    and (
      lower(profile.username) = lower(trim(search_value))
      or upper(profile.uid) = upper(trim(search_value))
    )
  limit 1;
$$;

create or replace function public.get_flowlock_friends()
returns table (user_id uuid, username text, uid text)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, profile.username, profile.uid
  from public.flowlock_friendships as friendship
  join public.flowlock_profiles as profile
    on profile.id = case when friendship.user_low = (select auth.uid())
      then friendship.user_high else friendship.user_low end
  where friendship.user_low = (select auth.uid())
     or friendship.user_high = (select auth.uid())
  order by lower(profile.username);
$$;

create or replace function public.get_flowlock_friend_requests()
returns table (request_id uuid, user_id uuid, username text, uid text, direction text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select request.id, profile.id, profile.username, profile.uid,
    case when request.recipient_id = (select auth.uid()) then 'incoming' else 'outgoing' end,
    request.created_at
  from public.flowlock_friend_requests as request
  join public.flowlock_profiles as profile
    on profile.id = case when request.recipient_id = (select auth.uid())
      then request.sender_id else request.recipient_id end
  where request.status = 'pending'
    and ((select auth.uid()) = request.sender_id or (select auth.uid()) = request.recipient_id)
  order by request.created_at desc;
$$;

create or replace function public.request_flowlock_friend(target_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if target_user = (select auth.uid()) then return 'self'; end if;
  if not exists (select 1 from public.flowlock_profiles where id = target_user) then return 'not_found'; end if;
  if exists (
    select 1 from public.flowlock_friendships
    where user_low = least((select auth.uid()), target_user)
      and user_high = greatest((select auth.uid()), target_user)
  ) then return 'already_friends'; end if;
  if exists (
    select 1 from public.flowlock_friend_requests
    where sender_id = target_user and recipient_id = (select auth.uid()) and status = 'pending'
  ) then return 'incoming_pending'; end if;

  insert into public.flowlock_friend_requests (sender_id, recipient_id, status, created_at)
  values ((select auth.uid()), target_user, 'pending', now())
  on conflict (sender_id, recipient_id) do update
    set status = 'pending', created_at = now();
  return 'pending';
end;
$$;

create or replace function public.respond_flowlock_friend_request(request_id uuid, accept_request boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_record public.flowlock_friend_requests%rowtype;
begin
  select * into request_record
  from public.flowlock_friend_requests
  where id = request_id and recipient_id = (select auth.uid()) and status = 'pending'
  for update;
  if not found then return false; end if;

  update public.flowlock_friend_requests
  set status = case when accept_request then 'accepted' else 'declined' end
  where id = request_record.id;

  if accept_request then
    insert into public.flowlock_friendships (user_low, user_high)
    values (least(request_record.sender_id, request_record.recipient_id),
      greatest(request_record.sender_id, request_record.recipient_id))
    on conflict do nothing;
  end if;
  return true;
end;
$$;

create or replace function public.delete_flowlock_friend_request(request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from public.flowlock_friend_requests
  where id = request_id and status = 'pending'
    and ((select auth.uid()) = sender_id or (select auth.uid()) = recipient_id);
  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

create or replace function public.remove_flowlock_friend(target_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from public.flowlock_friendships
  where user_low = least((select auth.uid()), target_user)
    and user_high = greatest((select auth.uid()), target_user);
  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

create or replace function public.flowlock_game_room_payload(room_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'code', room.code, 'game', room.game, 'mode', room.mode, 'capacity', room.capacity,
    'host', (select profile.username from public.flowlock_profiles as profile where profile.id = room.host_id),
    'members', coalesce((
      select jsonb_agg(profile.username order by member.ordinality)
      from unnest(room.member_ids) with ordinality as member(user_id, ordinality)
      join public.flowlock_profiles as profile on profile.id = member.user_id
    ), '[]'::jsonb),
    'invited', coalesce((
      select jsonb_agg(profile.username order by invite.ordinality)
      from unnest(room.invited_ids) with ordinality as invite(user_id, ordinality)
      join public.flowlock_profiles as profile on profile.id = invite.user_id
    ), '[]'::jsonb),
    'status', room.status, 'state', room.state, 'textEntries', room.text_entries,
    'createdAt', (extract(epoch from room.created_at) * 1000)::bigint
  )
  from public.flowlock_game_rooms as room
  where room.code = room_code;
$$;

create or replace function public.create_flowlock_game_room(room_code text, game_name text, room_mode text, room_capacity integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if (game_name not in ('snakes', 'checkers', 'property') or room_mode not in ('normal', 'text')) then
    raise exception 'Invalid game settings';
  end if;
  if room_capacity <> case when game_name = 'checkers' then 2 else 4 end then
    raise exception 'Invalid room capacity';
  end if;
  insert into public.flowlock_game_rooms (code, game, mode, capacity, host_id, member_ids)
  values (room_code, game_name, room_mode, room_capacity, (select auth.uid()), array[(select auth.uid())]);
  return public.flowlock_game_room_payload(room_code);
end;
$$;

create or replace function public.get_flowlock_game_room(room_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_record public.flowlock_game_rooms%rowtype;
begin
  select * into room_record from public.flowlock_game_rooms where code = room_code;
  if not found then return null; end if;
  if not ((select auth.uid()) = any(room_record.member_ids)
    or (select auth.uid()) = any(room_record.invited_ids)
    or (cardinality(room_record.invited_ids) = 0 and room_record.status = 'lobby')) then
    raise exception 'You are not allowed to view this room';
  end if;
  return public.flowlock_game_room_payload(room_code);
end;
$$;

create or replace function public.join_flowlock_game_room(room_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_record public.flowlock_game_rooms%rowtype;
  current_user_id uuid := (select auth.uid());
begin
  select * into room_record from public.flowlock_game_rooms where code = room_code for update;
  if not found then return null; end if;
  if current_user_id = any(room_record.member_ids) then return public.flowlock_game_room_payload(room_code); end if;
  if room_record.status <> 'lobby' or cardinality(room_record.member_ids) >= room_record.capacity then
    raise exception 'Room is full or closed';
  end if;
  if cardinality(room_record.invited_ids) > 0 and not (current_user_id = any(room_record.invited_ids)) then
    raise exception 'This room is invite-only';
  end if;
  update public.flowlock_game_rooms
  set member_ids = array_append(member_ids, current_user_id),
      invited_ids = array_remove(invited_ids, current_user_id)
  where code = room_code;
  return public.flowlock_game_room_payload(room_code);
end;
$$;

create or replace function public.invite_flowlock_game_friend(room_code text, target_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_record public.flowlock_game_rooms%rowtype;
begin
  select * into room_record from public.flowlock_game_rooms where code = room_code for update;
  if not found or room_record.host_id <> (select auth.uid()) then return false; end if;
  if not exists (
    select 1 from public.flowlock_friendships
    where user_low = least((select auth.uid()), target_user)
      and user_high = greatest((select auth.uid()), target_user)
  ) then raise exception 'You can only invite friends'; end if;
  if cardinality(room_record.member_ids) >= room_record.capacity then raise exception 'Room is full'; end if;
  update public.flowlock_game_rooms
  set invited_ids = case when target_user = any(invited_ids) or target_user = any(member_ids)
    then invited_ids else array_append(invited_ids, target_user) end
  where code = room_code;
  return true;
end;
$$;

create or replace function public.update_flowlock_game_room(room_code text, room_status text, room_state jsonb, text_entries jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.flowlock_game_rooms
  set status = room_status, state = room_state, text_entries = coalesce(text_entries, '{}'::jsonb)
  where code = room_code and (select auth.uid()) = any(member_ids);
  return found;
end;
$$;

create or replace function public.get_flowlock_game_invites()
returns table (code text, game text, mode text, host text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select room.code, room.game, room.mode, profile.username, room.created_at
  from public.flowlock_game_rooms as room
  join public.flowlock_profiles as profile on profile.id = room.host_id
  where (select auth.uid()) = any(room.invited_ids) and room.status = 'lobby'
  order by room.created_at desc;
$$;

create or replace function public.create_flowlock_trade_room(target_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_id text := 'ROOM-' || replace(gen_random_uuid()::text, '-', '');
begin
  if not exists (
    select 1 from public.flowlock_friendships
    where user_low = least((select auth.uid()), target_user)
      and user_high = greatest((select auth.uid()), target_user)
  ) then raise exception 'You can only trade with friends'; end if;
  insert into public.flowlock_trade_rooms (id, host_id, guest_id)
  values (room_id, (select auth.uid()), target_user);
  return room_id;
end;
$$;

create or replace function public.get_flowlock_trade_rooms()
returns table (id text, host text, guest text, status text, host_ready boolean, guest_ready boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select room.id, host.username, guest.username, room.status, room.host_ready, room.guest_ready, room.created_at
  from public.flowlock_trade_rooms as room
  join public.flowlock_profiles as host on host.id = room.host_id
  join public.flowlock_profiles as guest on guest.id = room.guest_id
  where (select auth.uid()) in (room.host_id, room.guest_id) and room.status <> 'closed'
  order by room.created_at desc;
$$;

create or replace function public.get_flowlock_trade_room(room_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  room_record public.flowlock_trade_rooms%rowtype;
  host_name text;
  guest_name text;
begin
  select * into room_record from public.flowlock_trade_rooms where id = room_id;
  if not found or (select auth.uid()) not in (room_record.host_id, room_record.guest_id) then return null; end if;
  select username into host_name from public.flowlock_profiles where id = room_record.host_id;
  select username into guest_name from public.flowlock_profiles where id = room_record.guest_id;
  return jsonb_build_object(
    'id', room_record.id, 'host', host_name, 'guest', guest_name, 'status', room_record.status,
    'ready', jsonb_build_object(host_name, room_record.host_ready, guest_name, room_record.guest_ready),
    'createdAt', (extract(epoch from room_record.created_at) * 1000)::bigint
  );
end;
$$;

create or replace function public.join_flowlock_trade_room(room_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.flowlock_trade_rooms set status = 'joined', host_ready = false, guest_ready = false
  where id = room_id and guest_id = (select auth.uid()) and status = 'invited';
  return found;
end;
$$;

create or replace function public.set_flowlock_trade_ready(room_id text, is_ready boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_record public.flowlock_trade_rooms%rowtype;
begin
  select * into room_record from public.flowlock_trade_rooms where id = room_id for update;
  if not found or (select auth.uid()) not in (room_record.host_id, room_record.guest_id)
    or room_record.status not in ('joined', 'trading') then return false; end if;
  update public.flowlock_trade_rooms
  set host_ready = case when host_id = (select auth.uid()) then is_ready else host_ready end,
      guest_ready = case when guest_id = (select auth.uid()) then is_ready else guest_ready end,
      status = case
        when (case when host_id = (select auth.uid()) then is_ready else host_ready end)
          and (case when guest_id = (select auth.uid()) then is_ready else guest_ready end) then 'trading'
        else 'joined' end
  where id = room_id;
  return true;
end;
$$;

create or replace function public.add_flowlock_trade_item(room_id text, item_id text, item_role text, item_category text, item_details text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_record public.flowlock_trade_rooms%rowtype;
begin
  select * into room_record from public.flowlock_trade_rooms where id = room_id;
  if not found or room_record.status <> 'trading'
    or (select auth.uid()) not in (room_record.host_id, room_record.guest_id) then
    raise exception 'Both participants must be ready before adding items';
  end if;
  if item_details ~* '(https?://|www[.]|password|passwd|passcode|otp|cookie|token|access.?key|login|รหัสผ่าน|พาสเวิร์ด|รหัสผู้ใช้|ชื่อผู้ใช้|อั่งเปา|ทรูมันนี่|ลิงก์|link|บัญชี)' then
    raise exception 'Trade details contain a link or sensitive information';
  end if;
  insert into public.flowlock_trade_items (id, room_id, from_id, to_id, role, category, details)
  values (item_id, room_id, (select auth.uid()),
    case when room_record.host_id = (select auth.uid()) then room_record.guest_id else room_record.host_id end,
    item_role, item_category, item_details);
  return true;
end;
$$;

create or replace function public.get_flowlock_trade_items(room_id text)
returns table (id text, room_id text, from_name text, to_name text, role text, category text, details text, confirmed_by text[], created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select item.id, item.room_id, sender.username, recipient.username, item.role, item.category, item.details,
    coalesce((select array_agg(profile.username order by member.ordinality)
      from unnest(item.confirmed_by) with ordinality as member(user_id, ordinality)
      join public.flowlock_profiles as profile on profile.id = member.user_id), '{}'::text[]), item.created_at
  from public.flowlock_trade_items as item
  join public.flowlock_trade_rooms as room on room.id = item.room_id
  join public.flowlock_profiles as sender on sender.id = item.from_id
  join public.flowlock_profiles as recipient on recipient.id = item.to_id
  where item.room_id = room_id and (select auth.uid()) in (room.host_id, room.guest_id)
  order by item.created_at;
$$;

create or replace function public.confirm_flowlock_trade_item(item_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_record public.flowlock_trade_rooms%rowtype;
begin
  select room.* into room_record
  from public.flowlock_trade_items as item
  join public.flowlock_trade_rooms as room on room.id = item.room_id
  where item.id = item_id and (select auth.uid()) in (room.host_id, room.guest_id);
  if not found then return false; end if;
  update public.flowlock_trade_items
  set confirmed_by = case when (select auth.uid()) = any(confirmed_by)
    then confirmed_by else array_append(confirmed_by, (select auth.uid())) end
  where id = item_id;
  return true;
end;
$$;

create or replace function public.get_flowlock_trade_history()
returns table (id text, room_id text, from_name text, to_name text, host text, guest text, role text, category text, details text, confirmed_by text[], created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select item.id, item.room_id, sender.username, recipient.username, host.username, guest.username,
    item.role, item.category, item.details,
    coalesce((select array_agg(profile.username order by member.ordinality)
      from unnest(item.confirmed_by) with ordinality as member(user_id, ordinality)
      join public.flowlock_profiles as profile on profile.id = member.user_id), '{}'::text[]), item.created_at
  from public.flowlock_trade_items as item
  join public.flowlock_trade_rooms as room on room.id = item.room_id
  join public.flowlock_profiles as sender on sender.id = item.from_id
  join public.flowlock_profiles as recipient on recipient.id = item.to_id
  join public.flowlock_profiles as host on host.id = room.host_id
  join public.flowlock_profiles as guest on guest.id = room.guest_id
  where (select auth.uid()) in (item.from_id, item.to_id)
  order by item.created_at desc;
$$;

revoke all on function public.lookup_flowlock_profile(text) from public, anon;
grant execute on function public.lookup_flowlock_profile(text) to authenticated;
revoke all on function public.get_flowlock_friends() from public, anon;
grant execute on function public.get_flowlock_friends() to authenticated;
revoke all on function public.get_flowlock_friend_requests() from public, anon;
grant execute on function public.get_flowlock_friend_requests() to authenticated;
revoke all on function public.request_flowlock_friend(uuid) from public, anon;
grant execute on function public.request_flowlock_friend(uuid) to authenticated;
revoke all on function public.respond_flowlock_friend_request(uuid, boolean) from public, anon;
grant execute on function public.respond_flowlock_friend_request(uuid, boolean) to authenticated;
revoke all on function public.delete_flowlock_friend_request(uuid) from public, anon;
grant execute on function public.delete_flowlock_friend_request(uuid) to authenticated;
revoke all on function public.remove_flowlock_friend(uuid) from public, anon;
grant execute on function public.remove_flowlock_friend(uuid) to authenticated;
revoke all on function public.flowlock_game_room_payload(text) from public, anon, authenticated;
revoke all on function public.create_flowlock_game_room(text, text, text, integer) from public, anon;
grant execute on function public.create_flowlock_game_room(text, text, text, integer) to authenticated;
revoke all on function public.get_flowlock_game_room(text) from public, anon;
grant execute on function public.get_flowlock_game_room(text) to authenticated;
revoke all on function public.join_flowlock_game_room(text) from public, anon;
grant execute on function public.join_flowlock_game_room(text) to authenticated;
revoke all on function public.invite_flowlock_game_friend(text, uuid) from public, anon;
grant execute on function public.invite_flowlock_game_friend(text, uuid) to authenticated;
revoke all on function public.update_flowlock_game_room(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.update_flowlock_game_room(text, text, jsonb, jsonb) to authenticated;
revoke all on function public.get_flowlock_game_invites() from public, anon;
grant execute on function public.get_flowlock_game_invites() to authenticated;
revoke all on function public.create_flowlock_trade_room(uuid) from public, anon;
grant execute on function public.create_flowlock_trade_room(uuid) to authenticated;
revoke all on function public.get_flowlock_trade_rooms() from public, anon;
grant execute on function public.get_flowlock_trade_rooms() to authenticated;
revoke all on function public.get_flowlock_trade_room(text) from public, anon;
grant execute on function public.get_flowlock_trade_room(text) to authenticated;
revoke all on function public.join_flowlock_trade_room(text) from public, anon;
grant execute on function public.join_flowlock_trade_room(text) to authenticated;
revoke all on function public.set_flowlock_trade_ready(text, boolean) from public, anon;
grant execute on function public.set_flowlock_trade_ready(text, boolean) to authenticated;
revoke all on function public.add_flowlock_trade_item(text, text, text, text, text) from public, anon;
grant execute on function public.add_flowlock_trade_item(text, text, text, text, text) to authenticated;
revoke all on function public.get_flowlock_trade_items(text) from public, anon;
grant execute on function public.get_flowlock_trade_items(text) to authenticated;
revoke all on function public.confirm_flowlock_trade_item(text) from public, anon;
grant execute on function public.confirm_flowlock_trade_item(text) to authenticated;
revoke all on function public.get_flowlock_trade_history() from public, anon;
grant execute on function public.get_flowlock_trade_history() to authenticated;

notify pgrst, 'reload schema';
