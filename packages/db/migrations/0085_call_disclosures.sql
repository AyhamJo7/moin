-- 0085 — each call bound to the tenant it was first routed to, the disclosure it was given, and
-- separate evidence that the caller heard it (ROADMAP S1; P11.02.04, INV-03, INV-11).
-- migration-check: allow create-index-blocking because every index here belongs to a table created earlier in this same migration, so it is new and empty.
--
-- ## `call_routes`: one tenant per CallSid, for good (global)
--
-- The inbound webhook resolves the dialled number to a tenant before anything is stored. A
-- provider retry of the same webhook can arrive after the number was reassigned, and
-- `calls.provider_call_sid` is unique only per tenant, so without a binding the retry would
-- store the first tenant's caller under the second. `call_routes` binds a CallSid (unique across
-- the provider) to the organisation its first delivery was routed to; `app.bind_call_route`
-- returns the bound organisation, and the webhook stores nothing when it differs from the
-- current route. It precedes the tenant write, so it cannot be tenant-scoped: like
-- `number_routes` (0026) the column is `route_organisation_id`, the table carries ids only, no
-- runtime role holds a table grant, and the one DEFINER function returns one uuid.
--
-- ## `call_disclosures`: what the TwiML carried
--
-- Written in the same transaction as the call row: the disclosure template version and the
-- business name it spoke. One per call; a retried webhook finds it and renders those stored
-- inputs again, so every delivery speaks the words first issued.
--
-- ## `call_disclosure_confirmations`: what the caller heard
--
-- A row means a caller turn arrived in an authenticated relay session for this call. The provider
-- sends caller turns only after the non-interruptible greeting has finished, so the row is the
-- evidence the full disclosure played. No row means unknown: no session, a hang-up during the
-- greeting, or a caller who listened and said nothing look the same from here, and none of them
-- is stored as a verdict.
--
-- The tenant tables are append-only for the runtime role (SELECT, INSERT).

CREATE TABLE call_routes (
  provider_call_sid     text        NOT NULL PRIMARY KEY
                                    CHECK (length(btrim(provider_call_sid)) BETWEEN 1 AND 100),
  route_organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  bound_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE call_routes IS
  'Provider CallSid → the tenant its first webhook was routed to (S1, INV-11). Global by necessity (binding precedes the tenant write): ids only, DEFINER-only access through app.bind_call_route.';

REVOKE ALL ON TABLE call_routes
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

-- First binding wins. Concurrent first deliveries serialise on the primary key: the loser's
-- insert waits, does nothing, and its select (a new snapshot) reads the winner's row.
CREATE FUNCTION app.bind_call_route(p_call_sid text, p_organisation_id uuid) RETURNS uuid
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_bound uuid;
BEGIN
  INSERT INTO public.call_routes (provider_call_sid, route_organisation_id)
  VALUES (p_call_sid, p_organisation_id)
  ON CONFLICT (provider_call_sid) DO NOTHING;
  SELECT r.route_organisation_id INTO v_bound
  FROM public.call_routes r
  WHERE r.provider_call_sid = p_call_sid;
  RETURN v_bound;
END
$$;

COMMENT ON FUNCTION app.bind_call_route(text, uuid) IS
  'Binds a CallSid to the organisation its first inbound webhook was routed to and returns the bound organisation (S1, INV-11). Returns one uuid and nothing else.';

REVOKE ALL ON FUNCTION app.bind_call_route(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.bind_call_route(text, uuid) TO moin_app;

CREATE TABLE call_disclosures (
  organisation_id    uuid        NOT NULL,
  id                 uuid        NOT NULL PRIMARY KEY,
  call_id            uuid        NOT NULL,
  disclosure_version text        NOT NULL CHECK (disclosure_version ~ '^[a-z0-9][a-z0-9.-]{0,63}$'),
  business_name      text        NOT NULL CHECK (length(btrim(business_name)) BETWEEN 1 AND 200),
  issued_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, call_id),
  FOREIGN KEY (organisation_id, call_id) REFERENCES calls (organisation_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE call_disclosures IS 'The disclosure a call was issued: template version and spoken business name (INV-03, P11.02.04). One per call, first issue wins.';

CREATE TABLE call_disclosure_confirmations (
  organisation_id uuid        NOT NULL,
  id              uuid        NOT NULL PRIMARY KEY,
  call_id         uuid        NOT NULL,
  confirmed_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, call_id),
  FOREIGN KEY (organisation_id, call_id) REFERENCES call_disclosures (organisation_id, call_id) ON DELETE CASCADE
);

COMMENT ON TABLE call_disclosure_confirmations IS 'Relay evidence that the issued disclosure played in full: a caller turn arrived after the non-interruptible greeting (INV-03). No row = unknown.';

SELECT app.apply_tenant_rls('call_disclosures');
SELECT app.apply_tenant_rls('call_disclosure_confirmations');

REVOKE ALL ON TABLE call_disclosures, call_disclosure_confirmations
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT ON call_disclosures, call_disclosure_confirmations TO moin_app;
