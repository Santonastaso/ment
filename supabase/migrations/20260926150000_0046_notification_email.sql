-- Where a member wants to be written to, which is not necessarily the address
-- they sign in with.
--
-- send-notification-outbox mails auth.users.email — the login identity. That
-- breaks whenever the two differ: during the pilot, where logins are
-- placeholders and nobody would receive anything; and later in production,
-- where an alumnus signs in with a school address they eventually lose access
-- to, or through SSO with no writable address at all.
--
-- Null means "use the login address", so production where the two match needs
-- no value set and behaves exactly as before.

alter table public.profiles
  add column if not exists notification_email text
    check (
      notification_email is null
      or (
        length(notification_email) <= 254
        and notification_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      )
    );

comment on column public.profiles.notification_email is
  'Delivery address for notifications. Null = fall back to auth.users.email. '
  'Personal data: owner-readable only, never exposed to peers.';

-- Peer visibility
-- ---------------------------------------------------------------------------
-- 0012 replaced the table-level SELECT grant on profiles with an explicit
-- column allowlist, so a column added later is unreadable to anon and
-- authenticated through PostgREST unless it is named there. This one is
-- deliberately left out, which is what keeps it private.
--
-- my_profile() is security definer and returns to_jsonb(the whole row), so the
-- owner still sees their own value with no further change. The peer-facing
-- RPCs (peer_profile, directory_browse, get_matches_for) build their responses
-- from explicit field lists, so nothing new leaks into them either — including
-- get_matches_for, which does `select * into v_other` but only reads named
-- fields off that record afterwards.

-- Keep it clean on the way in: trimmed, lower-cased, and an empty string
-- stored as null so the fallback is a single condition everywhere.
create or replace function public.normalize_notification_email()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.notification_email := nullif(lower(btrim(coalesce(new.notification_email, ''))), '');
  return new;
end;
$$;

revoke all on function public.normalize_notification_email() from public;

drop trigger if exists trg_profiles_normalize_notification_email on public.profiles;
create trigger trg_profiles_normalize_notification_email
  before insert or update of notification_email on public.profiles
  for each row execute function public.normalize_notification_email();
