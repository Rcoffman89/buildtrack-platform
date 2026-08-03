-- GL code export: maps vendor_trade values to an accounting GL code so invoices can be
-- exported for import into QuickBooks/HIA/etc. Scoped per-organization, not per-project — a
-- company's chart of accounts doesn't change project to project, and vendor_trade is already a
-- schema-wide enum, not something that varies per-project within the same org.

create table gl_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vendor_trade vendor_trade not null,
  gl_code text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, vendor_trade)
);

alter table gl_mappings enable row level security;

-- Same permission shape as vendors/invoices: any org member can read/create/edit/delete.
create policy "org members read gl_mappings" on gl_mappings
  for select to authenticated using (organization_id = auth_organization_id());
create policy "org members insert gl_mappings" on gl_mappings
  for insert to authenticated with check (organization_id = auth_organization_id());
create policy "org members update gl_mappings" on gl_mappings
  for update to authenticated using (organization_id = auth_organization_id());
create policy "org members delete gl_mappings" on gl_mappings
  for delete to authenticated using (organization_id = auth_organization_id());
