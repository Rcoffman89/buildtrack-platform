-- Undo for 0018_invoice_paid_exported.sql: removes the two columns it added.
-- This erases every paid date and exported mark entered since. Expenses themselves are untouched.
alter table public.invoices drop column if exists paid_date;
alter table public.invoices drop column if exists qb_exported_at;
notify pgrst, 'reload schema';
