create table if not exists public.flowlock_trade_offers (
  room_id text not null references public.flowlock_shared_rooms (id) on delete cascade,
  user_id uuid not null references public.flowlock_profiles (id) on delete cascade,
  side text not null check (side in ('payer', 'recipient')),
  offer_type text not null check (offer_type in ('wallet_link', 'public_id', 'redeem_code')),
  details jsonb not null,
  confirmed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id),
  unique (room_id, side)
);

create table if not exists public.flowlock_trade_readiness (
  room_id text not null references public.flowlock_shared_rooms (id) on delete cascade,
  user_id uuid not null references public.flowlock_profiles (id) on delete cascade,
  is_ready boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create or replace function public.get_flowlock_trade_offer(room_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  room_row public.flowlock_shared_rooms%rowtype;
  own_offer public.flowlock_trade_offers%rowtype;
  partner_offer public.flowlock_trade_offers%rowtype;
  own_exists boolean;
  partner_exists boolean;
  both_confirmed boolean;
  own_ready boolean;
  partner_ready boolean;
begin
  if (select auth.uid()) is null then return null; end if;

  select * into room_row
  from public.flowlock_shared_rooms
  where id = get_flowlock_trade_offer.room_id and kind = 'trade';
  if not found or not ((select auth.uid()) = any(room_row.participant_ids)) then return null; end if;

  select * into own_offer from public.flowlock_trade_offers
  where room_id = get_flowlock_trade_offer.room_id and user_id = (select auth.uid());
  own_exists := found;

  select * into partner_offer from public.flowlock_trade_offers
  where room_id = get_flowlock_trade_offer.room_id and user_id <> (select auth.uid());
  partner_exists := found;
  both_confirmed := own_exists and partner_exists and own_offer.confirmed and partner_offer.confirmed;

  select coalesce((
    select is_ready from public.flowlock_trade_readiness
    where room_id = get_flowlock_trade_offer.room_id and user_id = (select auth.uid())
  ), false) into own_ready;
  select coalesce((
    select is_ready from public.flowlock_trade_readiness
    where room_id = get_flowlock_trade_offer.room_id and user_id <> (select auth.uid())
  ), false) into partner_ready;

  return jsonb_build_object(
    'partnerName', (
      select username from public.flowlock_profiles
      where id = any(room_row.participant_ids) and id <> (select auth.uid())
      limit 1
    ),
    'ownOffer', case when own_exists then jsonb_build_object(
      'side', own_offer.side, 'type', own_offer.offer_type,
      'details', own_offer.details, 'confirmed', own_offer.confirmed
    ) else null end,
    'partnerSubmitted', partner_exists,
    'partnerConfirmed', coalesce(partner_offer.confirmed, false),
    'bothConfirmed', both_confirmed,
    'ownReady', own_ready,
    'partnerReady', partner_ready,
    'bothReady', own_ready and partner_ready,
    'partnerOffer', case when both_confirmed then jsonb_build_object(
      'side', partner_offer.side, 'type', partner_offer.offer_type,
      'details', partner_offer.details
    ) else null end
  );
end;
$$;

create or replace function public.set_flowlock_trade_ready(room_id text, is_ready boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_row public.flowlock_shared_rooms%rowtype;
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  select * into room_row from public.flowlock_shared_rooms
  where id = set_flowlock_trade_ready.room_id and kind = 'trade'
  for update;
  if not found or not (current_user_id = any(room_row.participant_ids))
    or not coalesce(room_row.payload ->> 'status' in ('joined', 'trading'), false) then
    return false;
  end if;
  if is_ready is null then raise exception 'Readiness value is required'; end if;
  if not is_ready and exists (
    select 1 from public.flowlock_trade_offers
    where room_id = set_flowlock_trade_ready.room_id and confirmed
  ) then
    raise exception 'Readiness cannot be withdrawn after offer confirmation';
  end if;

  insert into public.flowlock_trade_readiness (room_id, user_id, is_ready, updated_at)
  values (set_flowlock_trade_ready.room_id, current_user_id, is_ready, now())
  on conflict (room_id, user_id) do update
    set is_ready = excluded.is_ready, updated_at = now();
  return true;
end;
$$;

create or replace function public.submit_flowlock_trade_offer(
  room_id text, trade_side text, offer_type text, offer_details jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_row public.flowlock_shared_rooms%rowtype;
  current_user_id uuid := (select auth.uid());
  details_text text;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  select * into room_row from public.flowlock_shared_rooms
  where id = submit_flowlock_trade_offer.room_id and kind = 'trade'
  for update;
  if not found or not (current_user_id = any(room_row.participant_ids))
    or not coalesce(room_row.payload ->> 'status' in ('joined', 'trading'), false)
    or not exists (
      select 1 from public.flowlock_trade_readiness
      where room_id = submit_flowlock_trade_offer.room_id
        and user_id = current_user_id and is_ready
    )
    or not exists (
      select 1 from public.flowlock_trade_readiness
      where room_id = submit_flowlock_trade_offer.room_id
        and user_id <> current_user_id and is_ready
    ) then
    raise exception 'Both participants must be ready before submitting offers';
  end if;

  if trade_side is null or offer_type is null
    or trade_side not in ('payer', 'recipient')
    or (trade_side = 'payer' and offer_type <> 'wallet_link')
    or (trade_side = 'recipient' and offer_type not in ('public_id', 'redeem_code')) then
    raise exception 'Invalid trade role or offer type';
  end if;
  if exists (
    select 1 from public.flowlock_trade_offers
    where room_id = submit_flowlock_trade_offer.room_id
      and user_id <> current_user_id and side = trade_side
  ) then
    raise exception 'The other participant already selected this role';
  end if;

  details_text := coalesce(offer_details::text, '');
  if details_text ~* '(password|passwd|passcode|otp|recovery|cookie|login|credential|รหัสผ่าน|รหัสกู้คืน|รหัสเข้าใช้|พาสเวิร์ด)' then
    raise exception 'Do not submit passwords, OTPs, recovery codes, or login details';
  end if;
  if offer_type = 'wallet_link' and (
    jsonb_typeof(offer_details) <> 'object'
    or length(trim(coalesce(offer_details ->> 'url', ''))) > 2048
    or trim(coalesce(offer_details ->> 'url', '')) !~* '^https://[^[:space:]]+$'
  ) then
    raise exception 'Enter a valid HTTPS wallet link';
  elsif offer_type = 'public_id' and (
    jsonb_typeof(offer_details) <> 'object'
    or length(trim(coalesce(offer_details ->> 'name', ''))) not between 1 and 128
    or length(trim(coalesce(offer_details ->> 'value', ''))) not between 1 and 128
  ) then
    raise exception 'Enter both a profile name and a public ID';
  elsif offer_type = 'redeem_code' and (
    jsonb_typeof(offer_details) <> 'object'
    or length(trim(coalesce(offer_details ->> 'value', ''))) not between 1 and 256
  ) then
    raise exception 'Enter a valid non-login redemption code';
  end if;

  insert into public.flowlock_trade_offers (room_id, user_id, side, offer_type, details, confirmed, updated_at)
  values (submit_flowlock_trade_offer.room_id, current_user_id, trade_side, offer_type, offer_details, false, now())
  on conflict (room_id, user_id) do update
    set side = excluded.side, offer_type = excluded.offer_type,
        details = excluded.details, confirmed = false, updated_at = now();

  update public.flowlock_trade_offers
  set confirmed = false, updated_at = now()
  where room_id = submit_flowlock_trade_offer.room_id and user_id <> current_user_id;
  return true;
end;
$$;

create or replace function public.confirm_flowlock_trade_offer(room_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_row public.flowlock_shared_rooms%rowtype;
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  select * into room_row from public.flowlock_shared_rooms
  where id = confirm_flowlock_trade_offer.room_id and kind = 'trade'
  for update;
  if not found or not (current_user_id = any(room_row.participant_ids))
    or not coalesce(room_row.payload ->> 'status' in ('joined', 'trading'), false)
    or not exists (
      select 1 from public.flowlock_trade_readiness
      where room_id = confirm_flowlock_trade_offer.room_id
        and user_id = current_user_id and is_ready
    )
    or not exists (
      select 1 from public.flowlock_trade_readiness
      where room_id = confirm_flowlock_trade_offer.room_id
        and user_id <> current_user_id and is_ready
    )
    or not exists (
      select 1 from public.flowlock_trade_offers
      where room_id = confirm_flowlock_trade_offer.room_id and user_id = current_user_id
    )
    or not exists (
      select 1 from public.flowlock_trade_offers
      where room_id = confirm_flowlock_trade_offer.room_id and user_id <> current_user_id
    ) then
    return false;
  end if;

  update public.flowlock_trade_offers
  set confirmed = true, updated_at = now()
  where room_id = confirm_flowlock_trade_offer.room_id and user_id = current_user_id;
  return true;
end;
$$;

alter table public.flowlock_trade_offers enable row level security;
revoke all on table public.flowlock_trade_offers from anon, authenticated, public;
alter table public.flowlock_trade_readiness enable row level security;
revoke all on table public.flowlock_trade_readiness from anon, authenticated, public;

revoke all on function public.get_flowlock_trade_offer(text) from public, anon;
revoke all on function public.set_flowlock_trade_ready(text, boolean) from public, anon;
revoke all on function public.submit_flowlock_trade_offer(text, text, text, jsonb) from public, anon;
revoke all on function public.confirm_flowlock_trade_offer(text) from public, anon;
grant execute on function public.get_flowlock_trade_offer(text) to authenticated;
grant execute on function public.set_flowlock_trade_ready(text, boolean) to authenticated;
grant execute on function public.submit_flowlock_trade_offer(text, text, text, jsonb) to authenticated;
grant execute on function public.confirm_flowlock_trade_offer(text) to authenticated;

notify pgrst, 'reload schema';
