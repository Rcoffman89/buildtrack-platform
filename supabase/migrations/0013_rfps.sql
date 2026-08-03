-- Phase 3a: RFP / bid tracking, internal-entry model. Staff receive subcontractor bids the
-- normal way (email, phone, in person) and log them here for side-by-side comparison — this is
-- NOT a vendor-facing self-service portal (no public links, no email delivery to vendors). That
-- remains a distinct, larger future phase.

create type rfp_status as enum ('Draft', 'Open', 'Awarded', 'Cancelled');
create type rfp_bid_status as enum ('Pending', 'Awarded', 'Rejected');

create table rfps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  title text not null,
  scope_description text,
  trade vendor_trade,
  due_date date,
  status rfp_status not null default 'Draft',
  created_at timestamptz not null default now()
);

-- Plans/scope docs for the RFP itself — a separate table because an RFP can have several
-- (site plan, spec sheet, drawing set), unlike invoices which only ever needed one file.
create table rfp_documents (
  id uuid primary key default gen_random_uuid(),
  rfp_id uuid not null references rfps(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  uploaded_at timestamptz not null default now()
);

-- One row per vendor's quote against an RFP — the actual bid comparison data.
create table rfp_bids (
  id uuid primary key default gen_random_uuid(),
  rfp_id uuid not null references rfps(id) on delete cascade,
  vendor_id uuid not null references vendors(id) on delete cascade,
  amount numeric not null,
  notes text,
  file_path text,
  status rfp_bid_status not null default 'Pending',
  submitted_at date,
  created_at timestamptz not null default now()
);

alter table rfps enable row level security;
alter table rfp_documents enable row level security;
alter table rfp_bids enable row level security;

-- Same permission shape as tasks/vendors/invoices: any org member can read/create/edit/delete.
create policy "org members read rfps" on rfps
  for select to authenticated using (organization_id = auth_organization_id());
create policy "org members insert rfps" on rfps
  for insert to authenticated with check (organization_id = auth_organization_id());
create policy "org members update rfps" on rfps
  for update to authenticated using (organization_id = auth_organization_id());
create policy "org members delete rfps" on rfps
  for delete to authenticated using (organization_id = auth_organization_id());

create policy "org members read rfp_documents" on rfp_documents
  for select to authenticated using (
    exists (select 1 from rfps r where r.id = rfp_documents.rfp_id and r.organization_id = auth_organization_id())
  );
create policy "org members insert rfp_documents" on rfp_documents
  for insert to authenticated with check (
    exists (select 1 from rfps r where r.id = rfp_documents.rfp_id and r.organization_id = auth_organization_id())
  );
create policy "org members delete rfp_documents" on rfp_documents
  for delete to authenticated using (
    exists (select 1 from rfps r where r.id = rfp_documents.rfp_id and r.organization_id = auth_organization_id())
  );

create policy "org members read rfp_bids" on rfp_bids
  for select to authenticated using (
    exists (select 1 from rfps r where r.id = rfp_bids.rfp_id and r.organization_id = auth_organization_id())
  );
create policy "org members insert rfp_bids" on rfp_bids
  for insert to authenticated with check (
    exists (select 1 from rfps r where r.id = rfp_bids.rfp_id and r.organization_id = auth_organization_id())
  );
create policy "org members update rfp_bids" on rfp_bids
  for update to authenticated using (
    exists (select 1 from rfps r where r.id = rfp_bids.rfp_id and r.organization_id = auth_organization_id())
  );
create policy "org members delete rfp_bids" on rfp_bids
  for delete to authenticated using (
    exists (select 1 from rfps r where r.id = rfp_bids.rfp_id and r.organization_id = auth_organization_id())
  );

-- Private bucket for RFP plans/scope docs and vendor-submitted bid files. Same path-prefix
-- isolation model as the invoices bucket: `{organization_id}/{rfp_id}/{uuid}-{filename}`.
insert into storage.buckets (id, name, public)
values ('rfp-files', 'rfp-files', false)
on conflict (id) do nothing;

create policy "org members read own org rfp files" on storage.objects
  for select to authenticated using (
    bucket_id = 'rfp-files' and (storage.foldername(name))[1] = auth_organization_id()::text
  );
create policy "org members upload own org rfp files" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'rfp-files' and (storage.foldername(name))[1] = auth_organization_id()::text
  );
create policy "org members delete own org rfp files" on storage.objects
  for delete to authenticated using (
    bucket_id = 'rfp-files' and (storage.foldername(name))[1] = auth_organization_id()::text
  );
