-- Line items on an invoice (expense). Add-only: creates one new table and its RLS policies,
-- changes nothing that already exists. Safe to run once in the Supabase SQL editor; re-running
-- is harmless (create ... if not exists, policies dropped-if-exists only for this new table).
--
-- An invoice keeps its own total (invoices.amount) as the number that counts toward the budget.
-- Line items are the breakdown of that total, entered later by hand (or, in a later phase,
-- read from the invoice photo). The app shows the line-item sum next to the total so a gap is
-- visible, but never overwrites the total from the lines.

create table if not exists invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text not null,
  quantity numeric,
  unit_price numeric,
  amount numeric not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists invoice_line_items_invoice_id_idx on invoice_line_items (invoice_id);

alter table invoice_line_items enable row level security;

-- Same permission shape as invoices: any org member can read/create/edit/delete.
drop policy if exists "org members read invoice_line_items" on invoice_line_items;
drop policy if exists "org members insert invoice_line_items" on invoice_line_items;
drop policy if exists "org members update invoice_line_items" on invoice_line_items;
drop policy if exists "org members delete invoice_line_items" on invoice_line_items;

create policy "org members read invoice_line_items" on invoice_line_items
  for select to authenticated using (organization_id = auth_organization_id());
create policy "org members insert invoice_line_items" on invoice_line_items
  for insert to authenticated with check (organization_id = auth_organization_id());
create policy "org members update invoice_line_items" on invoice_line_items
  for update to authenticated using (organization_id = auth_organization_id());
create policy "org members delete invoice_line_items" on invoice_line_items
  for delete to authenticated using (organization_id = auth_organization_id());
