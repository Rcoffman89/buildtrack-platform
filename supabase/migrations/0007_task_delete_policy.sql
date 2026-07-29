-- Missed when the multi-tenant RLS policies were written: tasks had select/insert/update but
-- no delete policy, so deletes were silently no-op-ing for everyone (RLS default-denies with
-- no error, not a client bug). Matches the existing permission level for tasks — any org
-- member can create/edit tasks, so any org member can delete them too, consistent with that.
create policy "org members delete tasks" on tasks
  for delete to authenticated using (
    exists (select 1 from projects p where p.id = tasks.project_id and p.organization_id = auth_organization_id())
  );
