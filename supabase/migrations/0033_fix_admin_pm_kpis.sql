-- Correct the KPI function already installed by 0031. Fresh databases receive
-- the fixed source from 0031; existing projects are rewritten in place.
do $$
declare definition text;
begin
  select pg_get_functiondef(p.oid) into definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_pm_kpis'
    and pg_get_function_identity_arguments(p.oid) = 'p_org uuid';
  if definition like '%count(distinct x.user_id)%' then
    execute replace(definition, 'count(distinct x.user_id)', 'count(distinct x.id)');
  end if;
end $$;
