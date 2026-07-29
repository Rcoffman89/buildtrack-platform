-- Lets admins change an existing user's role directly (previously role could only be set
-- at invite time). Gated at the database level: only rows belonging to an admin's session
-- can perform the update, regardless of what the client sends.

create policy "admins can update roles" on public.profiles
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (true);
