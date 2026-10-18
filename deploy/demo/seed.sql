-- Synthetic demo tenant (INV-16): a made-up restaurant, a made-up Hamburg number, one owner.
-- Idempotent: ids are fixed, every insert is a no-op when the row exists, and the owner's
-- Keycloak subject is refreshed on every run (it changes if Keycloak's data volume was reset).
-- Run by demo.sh as the database owner, only against the moin-demo project's own database.
\set ON_ERROR_STOP on

insert into organisations (id, slug, name)
values ('00000000-0000-4000-8000-00000000d001', 'demo-musterrestaurant', 'Musterrestaurant (Demo)')
on conflict (id) do nothing;

insert into locations (organisation_id, id, name)
values ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000d002', 'Musterrestaurant Hamburg')
on conflict (id) do nothing;

insert into number_routes (e164, route_organisation_id, location_id, status)
values ('+494033330001', '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000d002', 'active')
on conflict (e164) do nothing;

insert into users (id, cognito_sub, email, status)
values ('00000000-0000-4000-8000-00000000d003', :'owner_sub', 'inhaber@musterrestaurant.example', 'active')
on conflict (id) do update set cognito_sub = excluded.cognito_sub;

insert into memberships (organisation_id, id, user_id, role, status)
values ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000d004', '00000000-0000-4000-8000-00000000d003', 'owner', 'active')
on conflict (id) do nothing;
