-- MENT — Supabase initial schema. Idempotent: safe to re-run on a fresh project.

-- =====================================================================
-- 1. TABLES
-- =====================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  department text not null default '',
  seniority text not null default 'junior',
  job_title text not null default '',
  tenure_years int not null default 0,
  location text not null default '',
  bio text not null default '',
  shadow_role_response text not null default '',
  pending_checkin boolean not null default false,
  manager_id uuid references public.profiles(id) on delete set null,
  must_change_password boolean not null default false,
  deactivated_at timestamptz,
  onboarding_complete boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.profile_drafts (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  raw_text text,
  proposed_json jsonb not null,
  accepted_json jsonb,
  classifier_source text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create table if not exists public.career_history (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_title text not null,
  department text not null,
  company text not null default '',
  description text not null default '',
  start_year int,
  start_month int,
  end_year int,
  end_month int
);

create table if not exists public.skills (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  skill text not null,
  type text not null check (type in ('can_teach','wants_to_learn')),
  example_project text not null default ''
);

create table if not exists public.connections (
  id bigserial primary key,
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id)
);

create table if not exists public.sessions (
  id bigserial primary key,
  mentor_id uuid not null references auth.users(id) on delete cascade,
  mentee_id uuid not null references auth.users(id) on delete cascade,
  connection_id bigint references public.connections(id) on delete set null,
  title text not null,
  scheduled_at timestamptz,
  duration_minutes int not null default 60,
  status text not null default 'pending' check (status in ('pending','scheduled','completed','declined','cancelled')),
  pre_session_question text not null default '',
  reflection text not null default '',
  mentor_reflection text not null default '',
  mentee_rating int check (mentee_rating between 1 and 5),
  mentor_rating int check (mentor_rating between 1 and 5),
  mentee_completed_at timestamptz,
  mentor_completed_at timestamptz,
  topics jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.match_scores (
  id bigserial primary key,
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  score int not null,
  reasons jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now(),
  unique (user_a_id, user_b_id),
  check (user_a_id < user_b_id)
);

create table if not exists public.audit_logs (
  id bigserial primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null default '',
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.reflection_logs (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  support_needed text not null default '',
  managed_well text not null default '',
  extracted_gaps jsonb not null default '[]'::jsonb,
  extracted_strengths jsonb not null default '[]'::jsonb,
  esco_uris jsonb not null default '{}'::jsonb,
  classifier_source text not null default '',
  applied boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists profiles_manager_id_idx on public.profiles(manager_id);
create index if not exists skills_user_type_idx on public.skills(user_id, type);
create index if not exists career_user_idx on public.career_history(user_id);
create index if not exists sessions_mentor_idx on public.sessions(mentor_id);
create index if not exists sessions_mentee_idx on public.sessions(mentee_id);
create index if not exists sessions_status_idx on public.sessions(status);
create index if not exists connections_requester_idx on public.connections(requester_id);
create index if not exists connections_addressee_idx on public.connections(addressee_id);
create index if not exists match_a_idx on public.match_scores(user_a_id);
create index if not exists match_b_idx on public.match_scores(user_b_id);
create index if not exists audit_action_idx on public.audit_logs(action);
create index if not exists audit_created_idx on public.audit_logs(created_at desc);
create index if not exists reflection_user_idx on public.reflection_logs(user_id, created_at desc);
