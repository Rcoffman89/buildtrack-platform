-- Phase 1 of budget/invoice/vendor tracking: vendors become a real entity instead of a free-text
-- name buried in task notes. Scoped per-organization like everything else. `assigned_to` on
-- tasks stays as-is for internal staff assignments; `vendor_id` is a separate, optional pointer
-- for tasks that are actually subcontracted out — most tasks (design review, permitting,
-- internal coordination) have no vendor at all.

create type vendor_trade as enum (
  'General Contractor',
  'Electrical',
  'Plumbing',
  'HVAC',
  'Structural/Steel',
  'Concrete',
  'Roofing',
  'Elevator',
  'Fire/Life Safety',
  'Landscaping',
  'Glazing/Curtain Wall',
  'Painting',
  'Flooring',
  'Low Voltage/IT',
  'Other'
);

create table vendors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  trade vendor_trade,
  contact_email text,
  contact_phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table tasks add column vendor_id uuid references vendors(id) on delete set null;

alter table vendors enable row level security;

-- Same permission shape as tasks: any org member can read/create/edit/delete vendor records.
create policy "org members read vendors" on vendors
  for select to authenticated using (organization_id = auth_organization_id());
create policy "org members insert vendors" on vendors
  for insert to authenticated with check (organization_id = auth_organization_id());
create policy "org members update vendors" on vendors
  for update to authenticated using (organization_id = auth_organization_id());
create policy "org members delete vendors" on vendors
  for delete to authenticated using (organization_id = auth_organization_id());
