-- Two column-level UPDATE grants on profiles.
--
-- 0012 replaced the table-level UPDATE grant with an explicit allowlist, the
-- same shape as the SELECT one. Adding a column in 0046 therefore made it
-- readable by its owner but writable by nobody: every save came back as a
-- permission error the client could only report as "Something went wrong".

grant update (notification_email) on public.profiles to authenticated;

-- While here, finish the Program lock.
--
-- Program is assigned by the school. The client stopped offering it and stopped
-- sending it, but `program` was still in this allowlist, so a direct PostgREST
-- call could set it — a UI convention rather than a rule. Take the grant away
-- and it becomes one.
--
-- Nothing legitimate loses a path to it: onboarding writes through
-- save_onboarding, which is security definer, and admin imports run as
-- service_role. Both bypass column grants.

revoke update (program) on public.profiles from authenticated;
