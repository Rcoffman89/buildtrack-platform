-- BuildTrack platform core schema. Run once in the Supabase SQL Editor.
-- Replaces the retired SharePoint list as the system of record for the Montego Venue schedule.

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text,
  status text not null default 'Not Started',
  milestone boolean not null default false,
  percent_complete int not null default 0 check (percent_complete between 0 and 100),
  notes text,
  assigned_to text,
  start_date date,
  due_date date,
  actual_finish_date date,
  status_changed_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Dependency graph. Replaces SharePoint's semicolon-delimited Predecessors text column
-- with a real join table — no more guessing whether Graph gave us a lookup or a text fallback.
create table if not exists task_predecessors (
  task_id uuid not null references tasks(id) on delete cascade,
  predecessor_id uuid not null references tasks(id) on delete cascade,
  primary key (task_id, predecessor_id)
);

-- General-purpose audit trail: every change to a task, who made it, and why.
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  task_id uuid references tasks(id) on delete set null,
  changed_by uuid references auth.users(id),
  change_type text not null,
  field_name text,
  old_value text,
  new_value text,
  reason text,
  created_at timestamptz not null default now()
);

alter table tasks enable row level security;
alter table task_predecessors enable row level security;
alter table audit_log enable row level security;

-- Small internal team, everyone logged in can see and edit everything — no per-row ownership needed yet.
create policy "authenticated read tasks" on tasks for select to authenticated using (true);
create policy "authenticated insert tasks" on tasks for insert to authenticated with check (true);
create policy "authenticated update tasks" on tasks for update to authenticated using (true);

create policy "authenticated read predecessors" on task_predecessors for select to authenticated using (true);
create policy "authenticated write predecessors" on task_predecessors for all to authenticated using (true) with check (true);

create policy "authenticated read audit_log" on audit_log for select to authenticated using (true);
create policy "authenticated insert audit_log" on audit_log for insert to authenticated with check (true);

-- Auto-stamp status_changed_date on any status change, and actual_finish_date the moment
-- a task first reaches Complete — mirrors what the retired cascade.js used to do by hand.
create or replace function tasks_set_status_metadata()
returns trigger as $$
begin
  new.updated_at = now();
  if new.status is distinct from old.status then
    new.status_changed_date = now();
  end if;
  if new.status = 'Complete' and old.status is distinct from 'Complete' and new.actual_finish_date is null then
    new.actual_finish_date = now();
  end if;
  return new;
end;
$$ language plpgsql;

create trigger tasks_before_update
  before update on tasks
  for each row execute function tasks_set_status_metadata();
