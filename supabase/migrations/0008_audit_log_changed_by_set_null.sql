-- audit_log.changed_by had no ON DELETE behavior (defaults to RESTRICT), so deleting a user
-- was silently blocked by their own audit history — Supabase's client reported this as a
-- generic 500 rather than the real FK violation, which is what made it look like a random
-- server error instead of what it actually was. Deleting a real user (not just test cleanup)
-- should never be blocked this way — old entries just show no user instead.
alter table audit_log
  drop constraint if exists audit_log_changed_by_fkey,
  add constraint audit_log_changed_by_fkey foreign key (changed_by) references public.profiles(id) on delete set null;
