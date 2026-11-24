-- Paid / due status and "exported to QuickBooks" mark on invoices (expenses).
-- Add-only: adds two empty columns to invoices and changes no existing data. Run once in the
-- Supabase SQL editor. A second run stops with a message and changes nothing.
-- Undo: 0018_invoice_paid_exported_UNDO.sql
--
--   paid_date            the date the expense was paid. Empty = still due.
--   qb_exported_at       when it was marked as imported into QuickBooks. Empty = not yet exported;
--                        the QuickBooks export leaves marked ones out unless asked to include them.
--
-- The existing invoice policies (org members can read/update their org's invoices) already cover
-- these columns, so no new policies are needed.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name in ('paid_date', 'qb_exported_at')
  ) then
    raise exception 'Paid and exported columns are already there. Nothing was changed.';
  end if;

  alter table public.invoices add column paid_date date;
  alter table public.invoices add column qb_exported_at timestamptz;
end $$;

notify pgrst, 'reload schema';
