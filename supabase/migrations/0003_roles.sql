-- Replaces the user_profiles view with a real table so we can attach a role to each user,
-- and so future joins (audit log, admin user list) have an actual FK to embed against.

drop view if exists public.user_profiles;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Everyone logged in can see the roster (needed to show "changed by" in the audit log,
-- and to list users on the admin screen). Writes only happen server-side via service_role
-- (the invite-user function and the new-user trigger below), never directly from the client.
create policy "authenticated read profiles" on public.profiles for select to authenticated using (true);

-- Auto-create a profile row the moment a new auth user is created (signup or invite).
-- Defaults to 'member' — the invite-user function promotes to 'admin' explicitly afterward
-- when an admin chooses that role for the invitee.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- audit_log.changed_by can now embed against a real table.
alter table audit_log
  drop constraint if exists audit_log_changed_by_fkey,
  add constraint audit_log_changed_by_fkey foreign key (changed_by) references public.profiles(id);
