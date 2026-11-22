-- 0085 — each call bound to its first routing decision, and the disclosure it was given
-- (ROADMAP S1; P11.02.04, INV-01, INV-03, INV-11).
-- migration-check: allow create-index-blocking because every index here belongs to a table created earlier in this same migration, so it is new and empty.
--
-- ## `call_routes`: one routing decision per CallSid, for good (global)
--
-- A provider retry of the inbound webhook can arrive after its number was activated, reassigned
-- or released, and `calls.provider_call_sid` is unique only per tenant. Without a record of the
-- first decision, a retry could store the caller under a tenant the call was never routed to.
-- `app.route_call` resolves the dialled number and records the decision for the CallSid in one
-- call: the organisation it routed to, or NULL when it routed nowhere (a refusal). The route row
-- is read `FOR SHARE`, so a reassignment or release waits for the decision to commit and cannot
-- interleave with it. Every later delivery gets the first decision back: the same organisation
-- only while the number still routes there, otherwise nothing. CallSids are never reused by the
-- provider, so a refusal does not need to expire.
--
-- It precedes tenancy, so it cannot be tenant-scoped: like `number_routes` (0026) the column is
-- `route_organisation_id`, the table carries ids only, no runtime role holds a table grant, and
-- the one DEFINER function returns the same two uuids `app.resolve_route` does.
--
-- ## `call_disclosures`: what the TwiML carried
--
-- Written in the same transaction as the call row: the disclosure template version and the
-- business name it spoke. One per call; a retried webhook finds it and renders those stored
-- inputs again, so every delivery speaks the words first issued. Append-only for the runtime
-- role (SELECT, INSERT).
--
-- Evidence that the caller heard the disclosure is not recorded here: the provider documents no
-- message tied to the end of the welcome greeting (ROADMAP S1b).

CREATE TABLE call_routes (
  provider_call_sid     text        NOT NULL PRIMARY KEY
                                    CHECK (provider_call_sid ~ '^CA[0-9a-f]{32}$'),
  route_organisation_id uuid        REFERENCES organisations (id) ON DELETE CASCADE,
  decided_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE call_routes IS
  'Provider CallSid → the first routing decision for it (S1, INV-11): an organisation, or NULL for a refusal. Global by necessity (the decision precedes tenancy): ids only, DEFINER-only access through app.route_call.';

REVOKE ALL ON TABLE call_routes
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

CREATE FUNCTION app.route_call(p_e164 text, p_call_sid text)
  RETURNS TABLE (organisation_id uuid, location_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_org      uuid;
  v_location uuid;
  v_bound    uuid;
BEGIN
  SELECT r.route_organisation_id, r.location_id INTO v_org, v_location
  FROM public.number_routes r
  WHERE r.e164 = p_e164 AND r.status = 'active'
  FOR SHARE;
  -- First decision wins. A concurrent first delivery waits on the primary key, does nothing,
  -- and reads the winner's row with the next statement's snapshot.
  INSERT INTO public.call_routes (provider_call_sid, route_organisation_id)
  VALUES (p_call_sid, v_org)
  ON CONFLICT (provider_call_sid) DO NOTHING;
  SELECT c.route_organisation_id INTO v_bound
  FROM public.call_routes c
  WHERE c.provider_call_sid = p_call_sid;
  IF v_org IS NULL OR v_bound IS NULL OR v_bound <> v_org THEN
    RETURN;
  END IF;
  organisation_id := v_org;
  location_id := v_location;
  RETURN NEXT;
END
$$;

COMMENT ON FUNCTION app.route_call(text, text) IS
  'Inbound call routing (S1, INV-11): resolves the dialled number and records the first decision for the CallSid in one call. Returns (organisation_id, location_id) only when the number routes to the organisation the CallSid was first bound to; otherwise zero rows.';

REVOKE ALL ON FUNCTION app.route_call(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.route_call(text, text) TO moin_app;

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

SELECT app.apply_tenant_rls('call_disclosures');

REVOKE ALL ON TABLE call_disclosures
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT ON call_disclosures TO moin_app;
