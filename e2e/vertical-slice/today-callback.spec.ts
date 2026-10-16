/**
 * M1 vertical slice in a real browser (P13.02.04 shape, M1): a simulated call becomes a callback
 * task that the signed-in restaurant owner sees on Heute, after a reload and after an API restart,
 * and the other tenant's task never appears.
 *
 * Everything runs for real except the call itself: a fresh PostgreSQL test database (migrated
 * template, application role NOBYPASSRLS), the API started as its production entry point
 * (`main-api.ts`), the owner app's standalone server, and sign-in through the local Keycloak's own
 * login form. The fixture pool stages the two tenants, the owner's `users` row (sign-in never
 * creates one) and the number routes — test fixtures, not the unfinished demo seed (P02.04.02).
 *
 * Synthetic data only (INV-16); the Keycloak user and password are the committed local fixtures.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, openSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { SIMULATED_CALL_PATH } from '@moin/contracts';
import { createTestDatabase, type TestDatabase } from '@moin/testing';
// The integration suite's template builder (migrations applied once); not a package export.
// Used only when no template exists: rebuilding or dropping the shared template would kill a
// concurrent integration run on the same PostgreSQL.
import { setup as buildTemplate } from '../../packages/testing/src/pg/global-setup.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const API_PORT = 3101;
const API_ORIGIN = `http://127.0.0.1:${String(API_PORT)}`;
const WEB_PORT = 3000;
const SIMULATOR_TOKEN = `e2e-slice-${randomUUID()}`;
const OWNER_EMAIL = 'inhaber@musterrestaurant.example';

const RESTAURANT_NUMBER = '+494033330001';
const OTHER_NUMBER = '+494044440001';
const CALLER = '+4915198765432';
const OTHER_TITLE = 'Rückruf: Lieferung Fremdbetrieb';

interface Realm {
  clients: { clientId: string; secret?: string }[];
  users: { email: string; credentials: { type: string; value: string }[] }[];
}

const realm = JSON.parse(
  readFileSync(resolve(ROOT, 'docker/keycloak/realm-moin-local.json'), 'utf8'),
) as Realm;

function fixturePassword(email: string): string {
  const value = realm.users.find((u) => u.email === email)?.credentials[0]?.value;
  if (value === undefined) throw new Error(`realm has no fixture user ${email}`);
  return value;
}

function clientSecret(clientId: string): string {
  const secret = realm.clients.find((c) => c.clientId === clientId)?.secret;
  if (secret === undefined) throw new Error(`realm has no secret for ${clientId}`);
  return secret;
}

function issuer(): string {
  const value = process.env['TEST_OIDC_ISSUER_URL'];
  if (value === undefined || !['127.0.0.1', 'localhost'].includes(new URL(value).hostname)) {
    throw new Error('TEST_OIDC_ISSUER_URL must point at the local Keycloak (see .env.example)');
  }
  return value;
}

/** The owner's Keycloak subject, learned through the fixture client exactly as the API test does. */
async function ownerSubject(): Promise<string> {
  const response = await fetch(`${issuer()}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'moin-tests',
      client_secret: clientSecret('moin-tests'),
      username: OWNER_EMAIL,
      password: fixturePassword(OWNER_EMAIL),
      scope: 'openid email',
    }),
  });
  const { id_token: idToken } = (await response.json()) as { id_token: string };
  const payload = JSON.parse(
    Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as { sub: string };
  return payload.sub;
}

let database: TestDatabase;
let api: ChildProcess | undefined;
let web: ChildProcess | undefined;

function logFile(): number {
  const directory = resolve(ROOT, 'test-results');
  mkdirSync(directory, { recursive: true });
  return openSync(resolve(directory, 'e2e-slice-processes.log'), 'a');
}

/** Own process group, so the whole tree is killed on cleanup. */
function start(
  command: string[],
  nodeEnv: 'test' | 'production',
  env: Record<string, string>,
): ChildProcess {
  const [file, ...args] = command;
  if (file === undefined) throw new Error('empty command');
  return spawn(file, args, {
    cwd: ROOT,
    env: {
      NODE_ENV: nodeEnv,
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? '',
      ...env,
    },
    detached: true,
    // Child output goes to test-results/ (ignored by git) for diagnosis; it carries no caller
    // content (INV-12 log allowlist) and only synthetic fixtures.
    stdio: ['ignore', logFile(), logFile()],
  });
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (child?.pid === undefined || child.exitCode !== null) return;
  const exited = new Promise<boolean>((done) =>
    child.once('exit', () => {
      done(true);
    }),
  );
  process.kill(-child.pid, 'SIGTERM');
  const graceful = await Promise.race([
    exited,
    new Promise<boolean>((done) =>
      setTimeout(() => {
        done(false);
      }, 10_000),
    ),
  ]);
  if (!graceful) process.kill(-child.pid, 'SIGKILL');
}

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`${url} did not come up within 60 s`);
}

async function startApi(): Promise<void> {
  const identityUrl = database.identityUrl;
  if (identityUrl === undefined) throw new Error('TEST_DATABASE_IDENTITY_URL is required');
  // The compiled entry point, as deployed (`start:api`): Node's type stripping cannot run the
  // decorators in the server source, so `pnpm --filter @moin/server build` runs first.
  api = start([process.execPath, 'apps/server/dist/main-api.js'], 'test', {
    SERVER_ROLE: 'api',
    PORT: String(API_PORT),
    LOG_LEVEL: 'warn',
    DATABASE_URL: database.appUrl,
    IDENTITY_DATABASE_URL: identityUrl,
    APP_ORIGIN: `http://localhost:${String(WEB_PORT)}`,
    OIDC_PROVIDER: 'keycloak',
    OIDC_ISSUER_URL: issuer(),
    OIDC_CLIENT_ID: 'moin-web',
    OIDC_CLIENT_SECRET: clientSecret('moin-web'),
    OIDC_REDIRECT_URI: `http://localhost:${String(WEB_PORT)}/api/auth/callback`,
    AUTH_LOCAL_TOKEN_KEY: 'local-v1:local-development-only',
    CALL_SIMULATOR_TOKEN: SIMULATOR_TOKEN,
  });
  await waitFor(`${API_ORIGIN}/healthz`);
}

async function simulateCall(to: string, utterance: string): Promise<string> {
  const response = await fetch(`${API_ORIGIN}${SIMULATED_CALL_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SIMULATOR_TOKEN}` },
    body: JSON.stringify({
      callSid: `SIM${randomUUID().replaceAll('-', '')}`,
      from: CALLER,
      to,
      utterance,
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { taskId: string }).taskId;
}

async function stageTenant(slug: string, number: string): Promise<{ id: string }> {
  const admin = database.fixturePool();
  const id = randomUUID();
  const locationId = randomUUID();
  await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
    id,
    slug,
    slug,
  ]);
  await admin.query('insert into locations (organisation_id, id, name) values ($1, $2, $3)', [
    id,
    locationId,
    `${slug} Haus`,
  ]);
  await admin.query(
    `insert into number_routes (e164, route_organisation_id, location_id, status)
     values ($1, $2, $3, 'active')`,
    [number, id, locationId],
  );
  return { id };
}

test.beforeAll(async () => {
  database = await createTestDatabase('e2e-slice').catch(async (error: unknown) => {
    // 3D000: the template database does not exist yet on this cluster.
    if ((error as { code?: unknown }).code !== '3D000') throw error;
    await buildTemplate();
    return createTestDatabase('e2e-slice');
  });
  const admin = database.fixturePool();
  const restaurant = await stageTenant('musterrestaurant', RESTAURANT_NUMBER);
  await stageTenant('fremdbetrieb', OTHER_NUMBER);
  const ownerId = randomUUID();
  await admin.query(
    `insert into users (id, cognito_sub, email, status) values ($1, $2, $3, 'active')`,
    [ownerId, await ownerSubject(), OWNER_EMAIL],
  );
  await admin.query(
    `insert into memberships (organisation_id, id, user_id, role, status)
     values ($1, $2, $3, 'owner', 'active')`,
    [restaurant.id, randomUUID(), ownerId],
  );
  await startApi();
  web = start([process.execPath, 'apps/web/.next/standalone/apps/web/server.js'], 'production', {
    PORT: String(WEB_PORT),
    HOSTNAME: 'localhost',
    OWNER_API_ORIGIN: API_ORIGIN,
  });
  await waitFor(`http://localhost:${String(WEB_PORT)}/`);
});

test.afterAll(async () => {
  await stop(web);
  await stop(api);
  // If beforeAll failed before the database existed, this throws as well; the run has failed.
  await database.drop();
});

test('a simulated callback call reaches the owner on Heute and stays there', async ({ page }) => {
  // Signed out: the page offers sign-in and holds no task data.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Heute' })).toBeVisible();
  await page.getByRole('link', { name: 'Anmelden' }).click();

  // Keycloak's own login form, then back through /api/auth/callback to Heute.
  await page.locator('#username').fill(OWNER_EMAIL);
  await page.locator('#password').fill(fixturePassword(OWNER_EMAIL));
  await page.locator('#kc-login').click();
  await page.waitForURL(`http://localhost:${String(WEB_PORT)}/`);
  const callbacks = page.getByRole('region', { name: 'Rückrufe' });
  await expect(callbacks).toContainText('Alles erledigt.');

  // The call: one for the restaurant, one for the other tenant.
  const taskId = await simulateCall(
    RESTAURANT_NUMBER,
    'Hallo, ich hätte gern einen Rückruf wegen einer Tischreservierung.',
  );
  await simulateCall(OTHER_NUMBER, 'Bitte rufen Sie mich zurück wegen Lieferung Fremdbetrieb');
  const createdAt = Date.now();

  await page.reload();
  const card = callbacks.locator(`[data-task-id="${taskId}"]`);
  await expect(card.getByRole('heading', { name: 'Rückruf: Tischreservierung' })).toBeVisible();
  await expect(card.getByRole('link', { name: CALLER })).toHaveAttribute('href', `tel:${CALLER}`);
  await expect(card).toContainText('Offen');
  await expect(card.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/u);
  expect(Date.now() - createdAt).toBeLessThan(60_000);
  await expect(page.getByText(OTHER_TITLE)).toHaveCount(0);

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toStrictEqual([]);
  await page.screenshot({
    path: test.info().outputPath('heute-with-callback.png'),
    fullPage: true,
  });

  // Restart the API process: the task and the session are rows, not memory.
  await stop(api);
  await startApi();
  await page.reload();
  await expect(card.getByRole('heading', { name: 'Rückruf: Tischreservierung' })).toBeVisible();
  await expect(page.getByText(OTHER_TITLE)).toHaveCount(0);
});
