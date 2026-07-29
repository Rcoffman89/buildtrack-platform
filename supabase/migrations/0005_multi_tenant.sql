-- Multi-tenant restructure: BuildTrack becomes a platform that hosts multiple client
-- organizations, each with their own projects, users, and data — fully isolated from each
-- other via RLS. Hospitality Ops 360 / Montego Venue becomes the first tenant, not a special
-- case baked into the schema.

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  client_name text,
  status text not null default 'On Track' check (status in ('On Track', 'At Risk', 'Complete', 'On Hold')),
  target_date date,
  created_at timestamptz not null default now()
);

alter table profiles add column if not exists organization_id uuid references organizations(id);
alter table tasks add column if not exists project_id uuid references projects(id) on delete cascade;
alter table audit_log add column if not exists organization_id uuid references organizations(id);

alter table organizations enable row level security;
alter table projects enable row level security;

-- Avoids RLS self-recursion: policies on `profiles` can't safely subquery `profiles` directly,
-- so every org-scoped policy goes through this instead. security definer means it runs with
-- the function owner's privileges, bypassing RLS just for this one lookup.
create or replace function auth_organization_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select organization_id from profiles where id = auth.uid();
$$;

create or replace function auth_is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select role from profiles where id = auth.uid()) = 'admin', false);
$$;

-- Drop the old single-tenant "everyone sees everything" policies.
drop policy if exists "authenticated read profiles" on profiles;
drop policy if exists "admins can update roles" on profiles;
drop policy if exists "authenticated read tasks" on tasks;
drop policy if exists "authenticated insert tasks" on tasks;
drop policy if exists "authenticated update tasks" on tasks;
drop policy if exists "authenticated read predecessors" on task_predecessors;
drop policy if exists "authenticated write predecessors" on task_predecessors;
drop policy if exists "authenticated read audit_log" on audit_log;
drop policy if exists "authenticated insert audit_log" on audit_log;

-- organizations: members can see their own org record only.
create policy "members read own org" on organizations
  for select to authenticated using (id = auth_organization_id());

-- projects: scoped to org membership; only admins create/edit projects.
create policy "org members read projects" on projects
  for select to authenticated using (organization_id = auth_organization_id());
create policy "org admins insert projects" on projects
  for insert to authenticated with check (organization_id = auth_organization_id() and auth_is_admin());
create policy "org admins update projects" on projects
  for update to authenticated using (organization_id = auth_organization_id() and auth_is_admin());

-- profiles: see co-workers in your own org; admins can update roles within their own org.
create policy "org members read profiles" on profiles
  for select to authenticated using (organization_id = auth_organization_id());
create policy "org admins update roles" on profiles
  for update to authenticated
  using (organization_id = auth_organization_id() and auth_is_admin())
  with check (organization_id = auth_organization_id());

-- tasks: scoped via the project's org.
create policy "org members read tasks" on tasks
  for select to authenticated using (
    exists (select 1 from projects p where p.id = tasks.project_id and p.organization_id = auth_organization_id())
  );
create policy "org members insert tasks" on tasks
  for insert to authenticated with check (
    exists (select 1 from projects p where p.id = tasks.project_id and p.organization_id = auth_organization_id())
  );
create policy "org members update tasks" on tasks
  for update to authenticated using (
    exists (select 1 from projects p where p.id = tasks.project_id and p.organization_id = auth_organization_id())
  );

-- task_predecessors: scoped the same way, via the task's project's org.
create policy "org members read predecessors" on task_predecessors
  for select to authenticated using (
    exists (
      select 1 from tasks t join projects p on p.id = t.project_id
      where t.id = task_predecessors.task_id and p.organization_id = auth_organization_id()
    )
  );
create policy "org members write predecessors" on task_predecessors
  for all to authenticated
  using (
    exists (
      select 1 from tasks t join projects p on p.id = t.project_id
      where t.id = task_predecessors.task_id and p.organization_id = auth_organization_id()
    )
  )
  with check (
    exists (
      select 1 from tasks t join projects p on p.id = t.project_id
      where t.id = task_predecessors.task_id and p.organization_id = auth_organization_id()
    )
  );

-- audit_log: has its own organization_id (role-change entries have no task_id to derive from),
-- set explicitly by the app at write time.
create policy "org members read audit_log" on audit_log
  for select to authenticated using (organization_id = auth_organization_id());
create policy "org members insert audit_log" on audit_log
  for insert to authenticated with check (organization_id = auth_organization_id());
