create table if not exists notifications (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table notifications enable row level security;

create policy "org members read notifications" on notifications
  for select to authenticated using (organization_id = auth_organization_id());
create policy "org members insert notifications" on notifications
  for insert to authenticated with check (organization_id = auth_organization_id());
