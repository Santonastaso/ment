-- =====================================================================
-- Storage buckets. Both private (no public read).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('imports', 'imports', false, 10485760,
   array['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel']),
  ('profile-uploads', 'profile-uploads', false, 10485760,
   array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'])
on conflict (id) do nothing;

-- Storage RLS: each user can only see/write objects under their own uid prefix.
drop policy if exists profile_uploads_own on storage.objects;
create policy profile_uploads_own on storage.objects
  for all to authenticated
  using (bucket_id = 'profile-uploads' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'profile-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- Imports bucket: admin-only writes/reads.
drop policy if exists imports_admin on storage.objects;
create policy imports_admin on storage.objects
  for all to authenticated
  using (bucket_id = 'imports' and public.is_admin(auth.uid()))
  with check (bucket_id = 'imports' and public.is_admin(auth.uid()));
