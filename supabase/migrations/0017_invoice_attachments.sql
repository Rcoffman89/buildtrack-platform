-- More than one photo (or PDF) per invoice/expense. Add-only: creates one new table and its RLS
-- policies, changes nothing that already exists. Run once in the Supabase SQL editor; running it
-- again is harmless (create ... if not exists; the policies dropped-if-exists are only this
-- table's own).
--
-- How the app uses it: invoices.file_path stays the FIRST photo, exactly as today, so every
-- existing invoice keeps showing its photo with no data copied anywhere. Each additional photo
-- is one row here. Until this script is run, the app keeps working with one photo per invoice
-- and says that more photos need this script.
--
-- Files live in the existing private `invoices` storage bucket under the same
-- `{organization_id}/{project_id}/...` paths, so the existing storage policies from 0010
-- already cover them. Nothing changes in storage.
--
-- To undo: run 0017_invoice_attachments_UNDO.sql.

create table if not exists invoice_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  file_path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists invoice_attachments_invoice_id_idx on invoice_attachments (invoice_id);

alter table invoice_attachments enable row level security;

-- Same permission shape as invoices: any org member can read/create/edit/delete.
drop policy if exists "org members read invoice_attachments" on invoice_attachments;
drop policy if exists "org members insert invoice_attachments" on invoice_attachments;
drop policy if exists "org members update invoice_attachments" on invoice_attachments;
drop policy if exists "org members delete invoice_attachments" on invoice_attachments;

create policy "org members read invoice_attachments" on invoice_attachments
  for select to authenticated using (organization_id = auth_organization_id());
create policy "org members insert invoice_attachments" on invoice_attachments
  for insert to authenticated with check (organization_id = auth_organization_id());
create policy "org members update invoice_attachments" on invoice_attachments
  for update to authenticated using (organization_id = auth_organization_id());
create policy "org members delete invoice_attachments" on invoice_attachments
  for delete to authenticated using (organization_id = auth_organization_id());
