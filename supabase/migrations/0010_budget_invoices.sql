-- Phase 2 of budget/invoice/vendor tracking: real budget numbers and invoices, on top of the
-- vendors entity from Phase 1. Actual cost = sum(invoices.amount), full stop — no "committed but
-- not yet invoiced" tracking in this phase, no forecasting, no approval workflow.

alter table projects add column target_budget numeric;
alter table tasks add column estimated_cost numeric;

create table invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  vendor_id uuid references vendors(id) on delete set null,
  amount numeric not null,
  invoice_date date,
  description text,
  file_path text,
  created_at timestamptz not null default now()
);

alter table invoices enable row level security;

-- Same permission shape as tasks/vendors: any org member can read/create/edit/delete invoices.
create policy "org members read invoices" on invoices
  for select to authenticated using (organization_id = auth_organization_id());
create policy "org members insert invoices" on invoices
  for insert to authenticated with check (organization_id = auth_organization_id());
create policy "org members update invoices" on invoices
  for update to authenticated using (organization_id = auth_organization_id());
create policy "org members delete invoices" on invoices
  for delete to authenticated using (organization_id = auth_organization_id());

-- Private bucket for invoice PDFs/images. Objects are stored at
-- `{organization_id}/{project_id}/{uuid}-{filename}`, and the storage policies below check that
-- the first path segment matches the caller's org — same isolation model as every table's RLS,
-- just expressed over storage.objects instead.
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

create policy "org members read own org invoice files" on storage.objects
  for select to authenticated using (
    bucket_id = 'invoices' and (storage.foldername(name))[1] = auth_organization_id()::text
  );
create policy "org members upload own org invoice files" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'invoices' and (storage.foldername(name))[1] = auth_organization_id()::text
  );
create policy "org members delete own org invoice files" on storage.objects
  for delete to authenticated using (
    bucket_id = 'invoices' and (storage.foldername(name))[1] = auth_organization_id()::text
  );
