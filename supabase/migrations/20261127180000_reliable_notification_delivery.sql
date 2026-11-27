-- Transactional notifications must not depend on GitHub Actions schedules:
-- scheduled runs are best-effort and can be delayed for hours. PostgreSQL owns
-- the queue, so it also owns the five-minute worker clock.

-- Create once, then retain only in Vault. The Edge Function verifies this value
-- through a service-role-only RPC; it is never exposed to browsers or migrations.
select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'notification_worker_token',
  'Authenticates pg_cron calls to send-notification-outbox'
)
where not exists (
  select 1 from vault.secrets where name = 'notification_worker_token'
);

create or replace function public.notification_worker_token_matches(p_token text)
returns boolean
language sql
security definer
set search_path = public, vault
as $$
  select coalesce(p_token, '') = coalesce((
    select decrypted_secret
    from vault.decrypted_secrets
    where name = 'notification_worker_token'
  ), '');
$$;

revoke all on function public.notification_worker_token_matches(text) from public, anon, authenticated;
grant execute on function public.notification_worker_token_matches(text) to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'mt-send-notification-outbox';

select cron.schedule(
  'mt-send-notification-outbox',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := 'https://vqvjdtnpcamyrqkqsrfb.supabase.co/functions/v1/send-notification-outbox',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Notification-Worker-Token', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'notification_worker_token'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$
);
