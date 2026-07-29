-- auth.users isn't exposed through the API by default (by design). This view exposes just
-- id + email so the app can show "changed by ryan@..." instead of a raw UUID in the audit log.
-- Fine for a small internal team where everyone already knows each other's email anyway.

create or replace view public.user_profiles as
select id, email from auth.users;

grant select on public.user_profiles to authenticated;
