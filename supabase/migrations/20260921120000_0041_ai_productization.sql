-- Production AI operations: content-free run telemetry and user-owned
-- discovery feedback. Prompts, documents, reflections, and generated copy are
-- deliberately excluded from telemetry.

create table public.ai_runs (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete cascade,
  feature text not null check (feature in ('discovery_match','discovery_draft','profile_ingest','reflection')),
  prompt_version text not null,
  model text not null,
  status text not null default 'succeeded' check (status in ('succeeded','failed')),
  latency_ms integer not null check (latency_ms >= 0),
  error_code text,
  created_at timestamptz not null default now()
);
create index ai_runs_org_created on public.ai_runs(organization_id, created_at desc);
alter table public.ai_runs enable row level security;
revoke all on public.ai_runs from public, anon, authenticated;
grant all on public.ai_runs to service_role;
grant select on public.ai_runs to authenticated;
create policy ai_runs_admin_read on public.ai_runs for select to authenticated using (
  public.is_admin(auth.uid()) and exists (
    select 1 from public.profiles viewer
    where viewer.id = auth.uid()
      and (viewer.admin_scope = 'platform' or viewer.organization_id = ai_runs.organization_id)
  )
);

create table public.discovery_feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  thread_id uuid not null references public.discovery_threads(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  helpful boolean not null,
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  unique(user_id, thread_id)
);
alter table public.discovery_feedback enable row level security;
revoke all on public.discovery_feedback from public, anon, authenticated;
grant select, insert, update on public.discovery_feedback to authenticated;
grant all on public.discovery_feedback to service_role;
create policy discovery_feedback_own on public.discovery_feedback for all to authenticated
using (user_id = auth.uid()) with check (
  user_id = auth.uid() and exists (
    select 1 from public.discovery_threads thread
    where thread.id = thread_id and thread.user_id = auth.uid()
  )
);
