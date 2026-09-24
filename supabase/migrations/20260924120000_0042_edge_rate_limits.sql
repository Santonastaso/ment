create table public.edge_rate_limits (
  key_hash text not null,
  window_start timestamptz not null,
  hit_count integer not null check (hit_count > 0),
  primary key (key_hash, window_start)
);

alter table public.edge_rate_limits enable row level security;
revoke all on public.edge_rate_limits from public, anon, authenticated;
grant all on public.edge_rate_limits to service_role;

create or replace function public.consume_edge_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_hit_count integer;
begin
  if auth.role() is distinct from 'service_role'
    or p_key_hash is null
    or p_key_hash !~ '^[a-f0-9]{64}$'
    or p_limit not between 1 and 1000000
    or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid_rate_limit_request';
  end if;

  v_window_start := to_timestamp(
    (floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds)::double precision
  );

  insert into public.edge_rate_limits as limits (key_hash, window_start, hit_count)
  values (p_key_hash, v_window_start, 1)
  on conflict (key_hash, window_start)
  do update set hit_count = limits.hit_count + 1
  returning hit_count into v_hit_count;

  return v_hit_count <= p_limit;
end;
$$;

revoke all on function public.consume_edge_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_edge_rate_limit(text, integer, integer) to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'mt-rate-limit-cleanup';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'mt-rate-limit-cleanup',
    '17 3 * * *',
    $job$delete from public.edge_rate_limits where window_start < now() - interval '2 days'$job$
  );
exception when undefined_table or undefined_function or invalid_schema_name then
  null;
end;
$$;
