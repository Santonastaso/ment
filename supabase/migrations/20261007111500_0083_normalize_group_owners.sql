-- Older groups predate the owner role. Keep display data consistent with created_by,
-- which remains the authorization source for all owner actions.
update public.group_members membership
set role = 'owner'
from public.groups group_row
where group_row.id = membership.group_id
  and group_row.created_by = membership.user_id
  and membership.role is distinct from 'owner';
