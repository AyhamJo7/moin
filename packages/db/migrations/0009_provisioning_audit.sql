-- P06.10 / INV-10: an accepted tenant is a business mutation, so its provisioning
-- request and audit event must commit or roll back together. The trigger runs as
-- the same reviewed migration/owner role as provision_tenant and append_audit_event.
CREATE FUNCTION app.audit_provisioning_request() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, app, pg_temp
AS $$
BEGIN
  IF app.current_org() IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'invalid provisioning audit context' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM app.append_audit_event(
    gen_random_uuid(), NULL, 'provisioning', 'tenant.provisioned', 'organisation',
    NEW.tenant_id, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
    'succeeded', NULL, NEW.request_id, NULL
  );
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.audit_provisioning_request() FROM PUBLIC;
CREATE TRIGGER provisioning_request_audit
  AFTER INSERT ON provisioning_requests
  FOR EACH ROW EXECUTE FUNCTION app.audit_provisioning_request();
