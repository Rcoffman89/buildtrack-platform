-- Undo for 0017_invoice_attachments.sql. Removes the extra-photos table and its policies.
--
-- What this does NOT touch: invoices.file_path (each invoice's first photo stays exactly as it
-- is) and the files in storage. Any second, third... photos added after 0017 stop showing in the
-- app, but their files stay in the `invoices` bucket and can still be found there.

drop table if exists invoice_attachments;
