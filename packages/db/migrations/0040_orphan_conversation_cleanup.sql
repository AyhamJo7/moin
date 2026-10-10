-- 0040 — orphan-conversation cleanup for the SID race fallback (P07.05 round-5/6).
--
-- `ingestCall` serialises same-SID ingests with an advisory lock, but the ON CONFLICT fallback
-- exists for lock bypass (hand-written SQL): it returns the winner while the loser's conversation
-- row — created before the conflicting call insert — would orphan, and `moin_app` holds no DELETE
-- on `conversations` since round-3. This DEFINER deletes exactly one ingest-shaped orphan: the
-- named conversation, and only when it is call-channel with NOTHING attached — no call, no
-- message thread, no outcome verdict. The four-way guard (not a caller promise) is what makes it
-- safe to expose: `ingestCall` only ever creates `channel = 'call'` rows, so message threads
-- (which always have a thread row) and decided interactions (which always have an outcome row)
-- can never match, and a live call's conversation can never match either. Erasure (P16) owns
-- every other delete through its privileged path.

CREATE FUNCTION app.delete_orphan_conversation(p_conversation_id uuid) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
BEGIN
  DELETE FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.organisation_id = app.current_org()
    AND c.channel = 'call'
    AND NOT EXISTS (
      SELECT 1 FROM public.calls k
      WHERE k.conversation_id = p_conversation_id
        AND k.organisation_id = c.organisation_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.conversation_id = p_conversation_id
        AND m.organisation_id = c.organisation_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.interaction_outcomes o
      WHERE o.conversation_id = p_conversation_id
        AND o.organisation_id = c.organisation_id
    );
END
$$;

REVOKE ALL ON FUNCTION app.delete_orphan_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.delete_orphan_conversation(uuid) TO moin_app;

COMMENT ON FUNCTION app.delete_orphan_conversation(uuid) IS
  'Deletes one call-channel conversation only when no call, message thread or outcome references it (ingestCall lock-bypass fallback). Tenant-scoped by app.current_org(); pointed at anything attached it deletes nothing.';
