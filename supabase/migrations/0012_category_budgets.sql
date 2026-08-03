-- Budget broken out by category, on top of the existing single project-level target_budget
-- (kept as-is — this is additive, not a replacement). Invoices get their own stored category
-- instead of deriving it from a linked task: task-derived would mean editing a task's category
-- later silently rewrites the category of every invoice ever linked to it, which is wrong for
-- financial history that should be a stable, point-in-time fact. The app still auto-fills this
-- field from the selected task as a convenience default at invoice-creation time.

alter table invoices add column category text;

create table project_category_budgets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  category text not null,
  target_amount numeric not null,
  created_at timestamptz not null default now(),
  unique (project_id, category)
);

alter table project_category_budgets enable row level security;

-- Same shape as target_budget on projects: any org member can view, only admins can set
-- targets.
create policy "org members read category_budgets" on project_category_budgets
  for select to authenticated using (
    exists (select 1 from projects p where p.id = project_category_budgets.project_id and p.organization_id = auth_organization_id())
  );
create policy "org admins insert category_budgets" on project_category_budgets
  for insert to authenticated with check (
    exists (
      select 1 from projects p
      where p.id = project_category_budgets.project_id and p.organization_id = auth_organization_id() and auth_is_admin()
    )
  );
create policy "org admins update category_budgets" on project_category_budgets
  for update to authenticated using (
    exists (
      select 1 from projects p
      where p.id = project_category_budgets.project_id and p.organization_id = auth_organization_id() and auth_is_admin()
    )
  );
create policy "org admins delete category_budgets" on project_category_budgets
  for delete to authenticated using (
    exists (
      select 1 from projects p
      where p.id = project_category_budgets.project_id and p.organization_id = auth_organization_id() and auth_is_admin()
    )
  );
