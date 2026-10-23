-- Removes the meetings added by scripts/demo/seed-field-links.sql, and only
-- those: completed meetings titled "[Demo] ..." between demo accounts of the
-- ment-demo organisation. Their messages and read markers go with them.
delete from public.sessions s
using public.profiles p, auth.users u
where s.title like '[Demo] %' and s.status = 'completed'
  and p.id = s.mentor_id and u.id = s.mentor_id
  and p.organization_id = (select id from public.organizations where slug = 'ment-demo')
  and (u.email like '%@ment.invalid' or u.email like '%@dummy.ment.io');
