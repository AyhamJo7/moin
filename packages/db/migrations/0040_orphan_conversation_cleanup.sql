-- 0040 — orphan-conversation cleanup for the SID race fallback (P07.05 round-5).
--
-- `ingestCall` serialises same-SID ingests with an advisory lock, but the ON CONFLICT fallback
-- exists for lock bypass (hand-written SQL): it returns the winner while the loser's conversation
-- row — created before the conflicting call insert — would orphan, and `moin_app` holds no DELETE
-- on `conversations` since round-3. This DEFINER deletes exactly one orphan: the named
-- conversation, and only when no call references it. The NOT EXISTS guard (not a caller promise)
-- is what makes it safe to expose: pointed at a live conversation it deletes nothing.

CREATE FUNCTION app.delete_orphan_conversation(p_conversation_id uuid) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
BEGIN
  DELETE FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.organisation_id = app.current_org()
    AND NOT EXISTS (
      SELECT 1 FROM public.calls k
      WHERE k.conversation_id = p_conversation_id
        AND k.organisation_id = c.organisation_id
    );
END
$$;

REVOKE ALL ON FUNCTION app.delete_orphan_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.delete_orphan_conversation(uuid) TO moin_app;

COMMENT ON FUNCTION app.delete_orphan_conversation(uuid) IS
  'Deletes one conversation only when no call references it (ingestCall lock-bypass fallback). Tenant-scoped by app.current_org(); pointed at a live conversation it deletes nothing.';
