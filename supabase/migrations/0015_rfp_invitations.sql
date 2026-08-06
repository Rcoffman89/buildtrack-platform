-- Phase 3b: vendor self-service RFP portal. Vendors submit bids themselves via a one-shot
-- token link instead of staff logging bids received through normal channels (Phase 3a).
--
-- This is the app's first unauthenticated-by-design surface. Every other table's RLS keys off
-- auth_organization_id(), which requires a logged-in Supabase session — a vendor visiting their
-- link has no session at all. The containment strategy is deliberately NOT to extend RLS to the
-- anon role on rfps/rfp_bids/storage (that would be new attack surface on tables that currently
-- have zero unauthenticated access). Instead, rfp_invitations grants no anon access either —
-- the only "authenticated" policies below are for staff generating/viewing invitations from the
-- RFP detail page. All vendor-facing token lookup and bid submission goes through a single
-- server-side function (service_role, bypassing RLS entirely by design), so 100% of the
-- unauthenticated attack surface is contained to one reviewable code path.

create table rfp_invitations (
  id uuid primary key default gen_random_uuid(),
  rfp_id uuid not null references rfps(id) on delete cascade,
  vendor_id uuid not null references vendors(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- At most one active (unused) invitation per vendor per RFP — regenerating a link means
-- deleting the old unused row first, so a stale link can never coexist with a fresh one.
create unique index rfp_invitations_active_unique on rfp_invitations (rfp_id, vendor_id) where used_at is null;

create index rfp_invitations_token_idx on rfp_invitations (token);

alter table rfp_invitations enable row level security;

-- Staff-side only: any org member can view/create/delete invitations for RFPs in their own
-- org, matching rfp_bids' permission shape. No policy here grants the anon role anything —
-- an anonymous request against this table via the client library gets zero rows, always. The
-- vendor-facing lookup goes through the gatekeeper function using service_role instead.
create policy "org members read rfp_invitations" on rfp_invitations
  for select to authenticated using (
    exists (select 1 from rfps r where r.id = rfp_invitations.rfp_id and r.organization_id = auth_organization_id())
  );
create policy "org members insert rfp_invitations" on rfp_invitations
  for insert to authenticated with check (
    exists (select 1 from rfps r where r.id = rfp_invitations.rfp_id and r.organization_id = auth_organization_id())
  );
create policy "org members delete rfp_invitations" on rfp_invitations
  for delete to authenticated using (
    exists (select 1 from rfps r where r.id = rfp_invitations.rfp_id and r.organization_id = auth_organization_id())
  );

-- Traceability: which bids came in through the vendor portal vs. staff logging one manually.
alter table rfp_bids add column invitation_id uuid references rfp_invitations(id) on delete set null;
