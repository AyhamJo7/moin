-- P06.10 / INV-10: append-only, tenant-scoped audit history.
-- An event and its head advance in the same transaction. No runtime role receives direct writes.

CREATE TABLE audit_argument_allowlist (
  operation text NOT NULL CHECK (operation ~ '^[a-z][a-z0-9_.-]{0,127}$'),
  argument_key text NOT NULL CHECK (argument_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  value_kind text NOT NULL CHECK (value_kind IN ('uuid', 'boolean', 'count')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  PRIMARY KEY (operation, argument_key)
);
COMMENT ON TABLE audit_argument_allowlist IS
  'Reviewed platform-wide audit argument keys. An unregistered key never reaches the audit trail.';
REVOKE ALL ON audit_argument_allowlist FROM moin_app, moin_provisioner;

CREATE TABLE audit_heads (
  organisation_id uuid NOT NULL PRIMARY KEY REFERENCES organisations(id),
  id uuid GENERATED ALWAYS AS (organisation_id) STORED,
  last_seq bigint NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  last_hash bytea NOT NULL DEFAULT decode(repeat('00', 32), 'hex')
    CHECK (octet_length(last_hash) = 32),
  UNIQUE (organisation_id, id)
);
SELECT app.apply_tenant_rls('audit_heads');
REVOKE ALL ON audit_heads FROM moin_app, moin_provisioner;
GRANT SELECT ON audit_heads TO moin_app;

CREATE TABLE audit_events (
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  id uuid NOT NULL PRIMARY KEY,
  seq bigint NOT NULL CHECK (seq > 0),
  prev_hash bytea NOT NULL CHECK (octet_length(prev_hash) = 32),
  hash bytea NOT NULL CHECK (octet_length(hash) = 32),
  actor_id uuid,
  source text NOT NULL CHECK (source IN ('api', 'voice', 'worker', 'operator', 'provisioning', 'system')),
  operation text NOT NULL CHECK (operation ~ '^[a-z][a-z0-9_.-]{0,127}$'),
  target_kind text NOT NULL CHECK (target_kind ~ '^[a-z][a-z0-9_]{0,63}$'),
  target_id uuid,
  versions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(versions) = 'object'),
  validation jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(validation) = 'object'),
  args_sanitized jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(args_sanitized) = 'object'),
  result text NOT NULL CHECK (result IN ('succeeded', 'failed', 'rejected', 'unknown')),
  approval_id uuid,
  correlation_id uuid,
  trace_id text CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  created_at timestamptz NOT NULL,
  canonical_payload text NOT NULL,
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, seq)
);
-- migration-check: allow create-index-blocking because the table is new and empty in this migration.
CREATE INDEX audit_events_target_idx ON audit_events(organisation_id, target_kind, target_id, seq DESC);
CREATE INDEX audit_events_actor_idx ON audit_events(organisation_id, actor_id, seq DESC);
CREATE INDEX audit_events_correlation_idx ON audit_events(organisation_id, correlation_id, seq DESC);
SELECT app.apply_tenant_rls('audit_events');
REVOKE ALL ON audit_events FROM moin_app, moin_provisioner;
GRANT SELECT ON audit_events TO moin_app;

CREATE FUNCTION app.reject_audit_mutation() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog
AS $$ BEGIN
  RAISE EXCEPTION 'audit events are append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
REVOKE ALL ON FUNCTION app.reject_audit_mutation() FROM PUBLIC;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_audit_mutation();

-- A fixed canonical payload is stored beside the structured columns. Rebuilding it detects a
-- changed column; hashing its stored UTF-8 bytes detects a changed payload or reordered chain.
CREATE FUNCTION app.audit_canonical_payload(
  p_org uuid, p_seq bigint, p_event_id uuid, p_actor uuid, p_source text,
  p_operation text, p_target_kind text, p_target_id uuid, p_versions jsonb,
  p_validation jsonb, p_args jsonb, p_result text, p_approval_id uuid,
  p_correlation_id uuid, p_trace_id text, p_created_at timestamptz
) RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object(
    'organisation_id', p_org, 'seq', p_seq, 'id', p_event_id, 'actor_id', p_actor,
    'source', p_source, 'operation', p_operation, 'target_kind', p_target_kind,
    'target_id', p_target_id, 'versions', p_versions, 'validation', p_validation,
    'args_sanitized', p_args, 'result', p_result, 'approval_id', p_approval_id,
    'correlation_id', p_correlation_id, 'trace_id', p_trace_id,
    'created_at_us', floor(extract(epoch FROM p_created_at) * 1000000)::bigint
  )::text
$$;
REVOKE ALL ON FUNCTION app.audit_canonical_payload(uuid, bigint, uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.audit_canonical_payload(uuid, bigint, uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid, text, timestamptz) TO moin_app;

CREATE FUNCTION app.append_audit_event(
  p_event_id uuid, p_actor_id uuid, p_source text, p_operation text,
  p_target_kind text, p_target_id uuid, p_versions jsonb, p_validation jsonb,
  p_args_sanitized jsonb, p_result text, p_approval_id uuid,
  p_correlation_id uuid, p_trace_id text
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_org uuid := app.current_org();
  v_seq bigint;
  v_prev bytea;
  v_hash bytea;
  v_payload text;
  v_created_at timestamptz := clock_timestamp();
BEGIN
  IF v_org IS NULL OR p_event_id IS NULL OR p_source IS NULL OR p_source NOT IN
       ('api', 'voice', 'worker', 'operator', 'provisioning', 'system')
    OR p_operation IS NULL OR p_operation !~ '^[a-z][a-z0-9_.-]{0,127}$'
    OR p_target_kind IS NULL OR p_target_kind !~ '^[a-z][a-z0-9_]{0,63}$'
    OR p_result IS NULL OR p_result NOT IN ('succeeded', 'failed', 'rejected', 'unknown')
    OR p_versions IS NULL OR jsonb_typeof(p_versions) <> 'object'
    OR p_validation IS NULL OR jsonb_typeof(p_validation) <> 'object'
    OR p_args_sanitized IS NULL OR jsonb_typeof(p_args_sanitized) <> 'object'
    OR (p_trace_id IS NOT NULL AND p_trace_id !~ '^[0-9a-f]{32}$')
  THEN
    RAISE EXCEPTION 'invalid audit event' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(p_versions) AS entry(key, value)
    WHERE entry.key NOT IN ('model', 'prompt', 'policy', 'template')
       OR entry.value !~ '^[A-Za-z0-9._:-]{1,64}$'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_each(p_validation) AS entry(key, value)
    WHERE entry.key !~ '^[a-z][a-z0-9_]{0,63}$'
       OR CASE jsonb_typeof(entry.value)
            WHEN 'boolean' THEN false
            WHEN 'number' THEN entry.value::text !~ '^(0([.][0-9]+)?|1([.]0+)?)$'
            ELSE true
          END
  ) OR EXISTS (
    SELECT 1 FROM jsonb_each(p_args_sanitized) AS arg(key, value)
    WHERE NOT EXISTS (
      SELECT 1 FROM audit_argument_allowlist allow
      WHERE allow.operation = p_operation AND allow.argument_key = arg.key
        AND (
          (allow.value_kind = 'uuid' AND jsonb_typeof(arg.value) = 'string'
            AND (arg.value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
          OR (allow.value_kind = 'boolean' AND jsonb_typeof(arg.value) = 'boolean')
          OR (allow.value_kind = 'count' AND jsonb_typeof(arg.value) = 'number'
            AND arg.value::text ~ '^(0|[1-9][0-9]{0,8})$')
        )
    )
  ) THEN
    RAISE EXCEPTION 'unapproved audit field' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO audit_heads(organisation_id) VALUES(v_org) ON CONFLICT DO NOTHING;
  SELECT last_seq, last_hash INTO v_seq, v_prev
    FROM audit_heads WHERE organisation_id = v_org FOR UPDATE;
  v_seq := v_seq + 1;
  v_payload := app.audit_canonical_payload(
    v_org, v_seq, p_event_id, p_actor_id, p_source, p_operation,
    p_target_kind, p_target_id, p_versions, p_validation, p_args_sanitized,
    p_result, p_approval_id, p_correlation_id, p_trace_id, v_created_at
  );
  v_hash := digest(v_prev || convert_to(v_payload, 'UTF8'), 'sha256');
  INSERT INTO audit_events(
    organisation_id, id, seq, prev_hash, hash, actor_id, source, operation,
    target_kind, target_id, versions, validation, args_sanitized, result,
    approval_id, correlation_id, trace_id, created_at, canonical_payload
  ) VALUES (
    v_org, p_event_id, v_seq, v_prev, v_hash, p_actor_id, p_source, p_operation,
    p_target_kind, p_target_id, p_versions, p_validation, p_args_sanitized, p_result,
    p_approval_id, p_correlation_id, p_trace_id, v_created_at, v_payload
  );
  UPDATE audit_heads SET last_seq = v_seq, last_hash = v_hash WHERE organisation_id = v_org;
  RETURN v_seq;
END $$;
REVOKE ALL ON FUNCTION app.append_audit_event(uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.append_audit_event(uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid, text) TO moin_app;
COMMENT ON FUNCTION app.append_audit_event(uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid, text)
  IS 'QG-09: append one tenant-scoped audit event and advance its hash chain atomically.';
