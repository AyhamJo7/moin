// Self-test cases for .semgrep/moin.yml (`semgrep --test .semgrep`). Never imported or compiled;
// excluded from the repository scan, typecheck, lint and prettier.
/* eslint-disable */
// @ts-nocheck

async function tenantFromRequest(request, reply, pool) {
  // ruleid: moin-tenant-id-from-request-input
  await withTenant(pool, request.body.organisationId, async () => {});

  const org = request.headers['x-organisation-id'];
  // ruleid: moin-tenant-id-from-request-input
  await withSystemWork(pool, org, async () => {});

  const { organisationId } = request.query;
  // ruleid: moin-tenant-id-from-request-input
  await withTenant(pool, organisationId, async () => {});

  // ok: moin-tenant-id-from-request-input
  await withTenant(pool, request.scope.organisationId, async () => {});

  // ok: moin-tenant-id-from-request-input
  await withTenant(pool, request.params.organisationId, async () => {});

  const found = await pool.query('select organisation_id from inbox where id = $1', [1]);
  // ok: moin-tenant-id-from-request-input
  await withTenant(pool, found.rows[0].organisation_id, async () => {});
}

async function sessionLevel(client, name, value, local) {
  // ruleid: moin-session-level-set-config
  await client.query('select set_config($1, $2, false)', [name, value]);
  // ruleid: moin-session-level-set-config
  await client.query('select set_config($1, $2, $3)', [name, value, local]);
  // ruleid: moin-session-level-set-config
  await client.query(`select set_config('app.knowledge_channel', $1, ${local})`, [value]);
  // ok: moin-session-level-set-config
  await client.query('select set_config($1, $2, true)', [name, value]);
  // ok: moin-session-level-set-config
  await client.query(`select set_config('app.knowledge_channel', $1, true)`, [value]);
}

async function outsideWrapper(client, org) {
  // ruleid: moin-tenant-setting-outside-wrapper
  await client.query("select set_config('app.organisation_id', $1, true)", [org]);
  // ok: moin-tenant-setting-outside-wrapper
  await client.query("select set_config('app.correlation_id', $1, true)", [org]);
}

async function errors(reply, log, work) {
  try {
    await work();
  } catch (err) {
    // ruleid: moin-error-detail-to-client
    reply.code(500).send(err);
  }
  try {
    await work();
  } catch (error) {
    // ruleid: moin-error-detail-to-client
    reply.send({ error: 'failed', detail: error.message });
  }
  try {
    await work();
  } catch (e) {
    // ruleid: moin-error-detail-to-client
    reply.send(e.stack);
  }
  try {
    await work();
  } catch (err) {
    log.error({ err }, 'work failed');
    // ok: moin-error-detail-to-client
    reply.code(500).send({ error: 'internal_error' });
  }
}
