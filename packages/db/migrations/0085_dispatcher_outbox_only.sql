-- 0085 — `moin_dispatcher` reaches the outbox and nothing else (P08.02.02; ROADMAP A1b, review of
-- #288).
--
-- 0062, 0064 and 0067 granted the dispatcher role SELECT and UPDATE on `job_runs`, `timers` and
-- the global `provider_inbox`, and 0063 UPDATE on every outbox column, for dispatchers that were
-- planned and never built. The only dispatcher that holds this credential is the outbox
-- dispatcher: it reads due outbox rows, marks them dispatched or backs them off, and writes job
-- rows as `moin_app`. With those grants a bug in it could rewrite any job's ledger state, any
-- timer, the provider inbox of every tenant, or an event's own content. They
-- are revoked; a later dispatcher that needs one gets it back in its own reviewed migration.
--
-- Nothing connected as `moin_dispatcher` before this release (no configuration carried its
-- credential), so no running code loses a privilege it uses.

REVOKE SELECT, UPDATE ON job_runs FROM moin_dispatcher;
REVOKE SELECT, UPDATE ON timers FROM moin_dispatcher;
REVOKE SELECT, UPDATE ON provider_inbox FROM moin_dispatcher;

-- On the outbox itself, updates are limited to the dispatch state: the event's tenant, aggregate,
-- version, type and payload are not the dispatcher's to change. A column UPDATE grant is enough for
-- the claim's `FOR UPDATE`.
REVOKE UPDATE ON outbox FROM moin_dispatcher;
GRANT UPDATE (dispatched_at, attempts, next_attempt_at) ON outbox TO moin_dispatcher;
