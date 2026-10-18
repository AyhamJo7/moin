/**
 * M1/M2A vertical slice in a real browser (P13.02.04 shape, P13.03.02 Erledigt): a simulated call
 * becomes a callback task that the signed-in restaurant owner sees on Heute, after a reload and
 * after an API restart, and the other tenant's task never appears. The owner then clicks
 * "Erledigt": the click reaches PostgreSQL through the session, CSRF and tenant guards, the card
 * leaves the live list, and the completion survives a reload, an API restart and a replay of the
 * original call. A stale view gets a truthful conflict message and a double click sends one request.
 *
 * M2B (P13.02.04, live Heute): the page that is already open picks up a callback committed after
 * it loaded, by itself and exactly once, within 60 s; a completion in one signed-in session reaches
 * another independent session; an outage leaves the list as it is and the page reconciles when the
 * network returns; a revoked session shows the signed-out page and no task data. The arrival
 * latency is measured from the task row's commit time to the card being visible in the browser,
 * and appended to `test-results/live-today-timings.jsonl`.
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
import { appendFileSync, cpSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { SIMULATED_CALL_PATH } from '@moin/contracts';
import { createTestDatabase, type TestDatabase } from '@moin/testing';
// The integration suite's template builder (migrations applied once); not a package export.
// Used only when no template exists, and then dropped again at the end, so the cluster is left as
// found: rebuilding a template that exists would kill a concurrent integration run, and leaving
// one behind would fail the next run's setup (it drops without unmarking).
import {
  setup as buildTemplate,
  teardown as dropTemplate,
} from '../../packages/testing/src/pg/global-setup.ts';

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
let builtTemplate = false;
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

async function simulateCall(
  to: string,
  utterance: string,
  callSid = `SIM${randomUUID().replaceAll('-', '')}`,
): Promise<string> {
  const response = await fetch(`${API_ORIGIN}${SIMULATED_CALL_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SIMULATOR_TOKEN}` },
    body: JSON.stringify({
      callSid,
      from: CALLER,
      to,
      utterance,
    }),
  });
  expect([200, 201]).toContain(response.status);
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

/** Keycloak's own login form, then back through /api/auth/callback to Heute. */
async function completeKeycloakLogin(page: Page): Promise<void> {
  await page.locator('#username').fill(OWNER_EMAIL);
  await page.locator('#password').fill(fixturePassword(OWNER_EMAIL));
  await page.locator('#kc-login').click();
  await page.waitForURL(`http://localhost:${String(WEB_PORT)}/`);
}

async function signInOwner(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('link', { name: 'Anmelden' }).click();
  await completeKeycloakLogin(page);
}

async function taskState(taskId: string) {
  const row = await database
    .fixturePool()
    .query<{ status: string; version: number }>('select status, version from tasks where id = $1', [
      taskId,
    ]);
  return row.rows[0];
}

async function statusAuditActors(taskId: string): Promise<(string | null)[]> {
  const rows = await database
    .fixturePool()
    .query<{ actor_id: string | null }>(
      "select actor_id from audit_events where target_id = $1 and operation = 'task.status' order by seq",
      [taskId],
    );
  return rows.rows.map((row) => row.actor_id);
}

test.beforeAll(async () => {
  database = await createTestDatabase('e2e-slice').catch(async (error: unknown) => {
    // 3D000: the template database does not exist yet on this cluster.
    if ((error as { code?: unknown }).code !== '3D000') throw error;
    await buildTemplate();
    builtTemplate = true;
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
  // Next's standalone output omits the static assets (the client island's scripts); the image
  // recipe copies them next to the server, and so does this run. Build output, never committed.
  cpSync(
    resolve(ROOT, 'apps/web/.next/static'),
    resolve(ROOT, 'apps/web/.next/standalone/apps/web/.next/static'),
    { recursive: true },
  );
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
  if (builtTemplate) await dropTemplate();
});

test('a simulated callback call reaches the owner on Heute and stays there', async ({ page }) => {
  // Signed out: the page offers sign-in and holds no task data.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Heute' })).toBeVisible();
  await page.getByRole('link', { name: 'Anmelden' }).click();

  await completeKeycloakLogin(page);
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

test('the owner completes a callback with Erledigt and it stays completed', async ({ page }) => {
  // A blocked script (CSP, missing asset) would leave the button inert: any console error fails.
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await signInOwner(page);
  const callbacks = page.getByRole('region', { name: 'Rückrufe' });
  const callSid = `SIM${randomUUID().replaceAll('-', '')}`;
  const utterance = 'Bitte rufen Sie mich zurück wegen einer Tischreservierung.';
  const taskId = await simulateCall(RESTAURANT_NUMBER, utterance, callSid);
  await simulateCall(OTHER_NUMBER, 'Bitte rufen Sie mich zurück wegen Lieferung Fremdbetrieb');
  await page.reload();
  const card = callbacks.locator(`[data-task-id="${taskId}"]`);
  await expect(card).toContainText('Offen');
  // Earlier tests leave their own open callbacks in this database: count, never expect empty.
  const liveCards = callbacks.locator('[data-task-id]');
  const liveBefore = await liveCards.count();
  const action = card.getByRole('button', { name: /^Erledigt/u });
  await expect(action).toBeVisible();
  await expect(action).toHaveAccessibleName(/Rückruf: Tischreservierung/u);

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toStrictEqual([]);
  await page.screenshot({
    path: test.info().outputPath('heute-erledigt-before.png'),
    fullPage: true,
  });

  // A double click sends one request: the second click lands on a busy button and does nothing.
  const posts: string[] = [];
  await page.route('**/api/tasks/*/complete', async (route) => {
    posts.push(route.request().method());
    await new Promise((done) => setTimeout(done, 600));
    await route.continue();
  });
  await action.dblclick();
  await expect(page.getByTestId('action-notice')).toHaveText(
    'Der Rückruf ist als erledigt markiert.',
  );
  expect(posts).toStrictEqual(['POST']);
  await page.unroute('**/api/tasks/*/complete');

  // The page re-read the server: the card has left the live list and the section is empty again.
  await expect(card).toHaveCount(0);
  await expect(liveCards).toHaveCount(liveBefore - 1);
  await page.screenshot({
    path: test.info().outputPath('heute-erledigt-after.png'),
    fullPage: true,
  });

  // The database holds it, as the owner's own act, three audited moves of the one state machine.
  expect(await taskState(taskId)).toStrictEqual({ status: 'done', version: 4 });
  const actors = await statusAuditActors(taskId);
  expect(actors).toHaveLength(3);
  expect(new Set(actors).size).toBe(1);
  expect(actors[0]).not.toBeNull();

  // Reload, then an API restart: still completed, never back in the live list.
  await page.reload();
  await expect(card).toHaveCount(0);
  await stop(api);
  await startApi();
  await page.reload();
  await expect(card).toHaveCount(0);
  await expect(liveCards).toHaveCount(liveBefore - 1);

  // The original call arrives again: nothing is reopened, no second task appears.
  expect(await simulateCall(RESTAURANT_NUMBER, utterance, callSid)).toBe(taskId);
  await page.reload();
  await expect(card).toHaveCount(0);
  await expect(liveCards).toHaveCount(liveBefore - 1);
  expect(await taskState(taskId)).toStrictEqual({ status: 'done', version: 4 });
  expect(await statusAuditActors(taskId)).toHaveLength(3);
  await expect(page.getByText(OTHER_TITLE)).toHaveCount(0);
  expect(consoleErrors).toStrictEqual([]);
});

test('a stale view gets a truthful conflict message and the current state', async ({
  browser,
  page,
}) => {
  await signInOwner(page);
  const callbacks = page.getByRole('region', { name: 'Rückrufe' });
  const taskId = await simulateCall(
    RESTAURANT_NUMBER,
    'Bitte rufen Sie mich zurück wegen einer Tischreservierung.',
  );
  await page.reload();
  const card = callbacks.locator(`[data-task-id="${taskId}"]`);
  await expect(card).toBeVisible();

  // Another window of the same owner completes the task first.
  const second = await browser.newContext({ storageState: await page.context().storageState() });
  const other = await second.newPage();
  await other.goto('http://localhost:3000/');
  await other
    .locator(`[data-task-id="${taskId}"]`)
    .getByRole('button', { name: /^Erledigt/u })
    .click();
  await expect(other.getByTestId('action-notice')).toHaveText(
    'Der Rückruf ist als erledigt markiert.',
  );
  expect(await taskState(taskId)).toStrictEqual({ status: 'done', version: 4 });
  await second.close();

  // The first window still shows the old card. Its click is refused, nothing is written twice,
  // the owner is told the task changed, and the view is re-read.
  await card.getByRole('button', { name: /^Erledigt/u }).click();
  await expect(page.getByTestId('action-notice')).toContainText(
    'Diese Aufgabe wurde inzwischen geändert.',
  );
  await expect(page.getByTestId('action-notice')).not.toContainText('erledigt markiert');
  await expect(card).toHaveCount(0);
  expect(await taskState(taskId)).toStrictEqual({ status: 'done', version: 4 });
  expect(await statusAuditActors(taskId)).toHaveLength(3);
});

/** A fresh callback for the restaurant and its card on a reloaded Heute. */
async function freshCallback(page: Page) {
  const taskId = await simulateCall(
    RESTAURANT_NUMBER,
    'Bitte rufen Sie mich zurück wegen einer Tischreservierung.',
  );
  await page.reload();
  const card = page.getByRole('region', { name: 'Rückrufe' }).locator(`[data-task-id="${taskId}"]`);
  await expect(card).toBeVisible();
  return { taskId, card };
}

const COMMITTED_MESSAGE = 'Der Rückruf ist als erledigt markiert.';
const UNKNOWN_MESSAGE =
  'Der aktuelle Stand konnte nicht bestätigt werden. Bitte prüfen Sie die aktualisierte Ansicht.';

test('a response lost after the commit is reconciled by reading the task, not reported as a failure', async ({
  page,
}) => {
  await signInOwner(page);
  const { taskId, card } = await freshCallback(page);
  // The request reaches the server and commits; the browser never sees the answer.
  let reachedServer = 0;
  await page.route('**/api/tasks/*/complete', async (route) => {
    await route.fetch();
    reachedServer += 1;
    await route.abort('failed');
  });
  await card.getByRole('button', { name: /^Erledigt/u }).click();
  await expect(page.getByTestId('action-notice')).toHaveText(COMMITTED_MESSAGE);
  await expect(page.getByTestId('action-notice')).not.toContainText('nicht geklappt');
  await expect(card).toHaveCount(0);
  expect(reachedServer).toBe(1);
  // The database, not the page, is the authority: one completion, three audited moves.
  expect(await taskState(taskId)).toStrictEqual({ status: 'done', version: 4 });
  expect(await statusAuditActors(taskId)).toHaveLength(3);
});

test('a lost response that cannot be read back is unknown, and the refreshed view shows the truth', async ({
  page,
}) => {
  await signInOwner(page);
  const { taskId, card } = await freshCallback(page);
  await page.route('**/api/tasks/*/complete', async (route) => {
    await route.fetch();
    await route.abort('failed');
  });
  // The read-back fails too: nothing can be confirmed from the browser.
  await page.route(`**/api/tasks/${taskId}`, (route) => route.abort('failed'));
  await card.getByRole('button', { name: /^Erledigt/u }).click();
  await expect(page.getByTestId('action-notice')).toHaveText(UNKNOWN_MESSAGE);
  await expect(page.getByTestId('action-notice')).not.toContainText('erledigt markiert');
  await expect(page.getByTestId('action-notice')).not.toContainText('nicht geklappt');
  // The authoritative refresh shows what the database holds: the commit happened.
  await expect(card).toHaveCount(0);
  expect(await taskState(taskId)).toStrictEqual({ status: 'done', version: 4 });
});

test('a request that never reached the server is unknown to the browser; the retry completes once, by keyboard', async ({
  page,
}) => {
  await signInOwner(page);
  const { taskId, card } = await freshCallback(page);
  let attempts = 0;
  await page.route('**/api/tasks/*/complete', async (route) => {
    attempts += 1;
    await route.abort('failed');
  });
  const action = card.getByRole('button', { name: /^Erledigt/u });
  await action.click();
  await expect(page.getByTestId('action-notice')).toHaveText(UNKNOWN_MESSAGE);
  // Nothing was written, and the refreshed card is still there with the same version.
  await expect(card).toBeVisible();
  expect(await taskState(taskId)).toStrictEqual({ status: 'open', version: 1 });
  expect(await statusAuditActors(taskId)).toHaveLength(0);
  expect(attempts).toBe(1);

  // The network is back: the owner repeats the action with the keyboard only.
  await page.unroute('**/api/tasks/*/complete');
  const retry = card.getByRole('button', { name: /^Erledigt/u });
  await retry.focus();
  await expect(retry).toBeFocused();
  await page.keyboard.press('Enter');
  const notice = page.getByTestId('action-notice');
  await expect(notice).toHaveText(COMMITTED_MESSAGE);
  await expect(notice).toHaveAttribute('role', 'status');
  await expect(notice).toHaveAttribute('aria-live', 'polite');
  // The card that held focus is gone; focus moved to the outcome instead of the page body.
  await expect(notice).toBeFocused();
  await expect(card).toHaveCount(0);
  expect(await taskState(taskId)).toStrictEqual({ status: 'done', version: 4 });
  expect(await statusAuditActors(taskId)).toHaveLength(3);
});

// ---- M2B: live Heute (P13.02.04) ----------------------------------------------------------------

const ARRIVAL_LIMIT_MS = 60_000;
/** Longer than one poll interval plus the request and render (lib/live-today.ts: 15 s). */
const SETTLE_MS = 20_000;

/** The milliseconds since the epoch at which Postgres stamped the task row. */
async function committedAtMs(taskId: string): Promise<number> {
  const row = await database
    .fixturePool()
    .query<{ ms: number }>(
      'select (extract(epoch from created_at) * 1000)::float8 as ms from tasks where id = $1',
      [taskId],
    );
  return row.rows[0]?.ms ?? Number.NaN;
}

function recordTiming(label: string, milliseconds: number): void {
  expect(milliseconds).toBeLessThan(ARRIVAL_LIMIT_MS);
  const directory = resolve(ROOT, 'test-results');
  mkdirSync(directory, { recursive: true });
  appendFileSync(
    resolve(directory, 'live-today-timings.jsonl'),
    `${JSON.stringify({ label, milliseconds: Math.round(milliseconds), at: new Date().toISOString() })}\n`,
  );
}

async function signInOwnerInNewContext(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: `http://localhost:${String(WEB_PORT)}`,
    locale: 'de-DE',
  });
  const page = await context.newPage();
  await signInOwner(page);
  return page;
}

test('a callback committed while Heute is open appears by itself, once, without a reload', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await signInOwner(page);
  const callbacks = page.getByRole('region', { name: 'Rückrufe' });
  await expect(callbacks).toBeVisible();
  // Marks of "the page was not reloaded": a performance mark dies with the document, and focus on
  // an element that survives the server re-render stays where the owner put it.
  await page.evaluate(() => {
    performance.mark('opened-before-the-call');
  });
  const refresh = page.getByRole('link', { name: 'Aktualisieren' });
  await refresh.focus();

  const taskId = await simulateCall(
    RESTAURANT_NUMBER,
    'Hallo, ich hätte gern einen Rückruf wegen einer Tischreservierung.',
  );
  await simulateCall(OTHER_NUMBER, 'Bitte rufen Sie mich zurück wegen Lieferung Fremdbetrieb');
  const card = callbacks.locator(`[data-task-id="${taskId}"]`);
  await expect(card.getByRole('heading', { name: 'Rückruf: Tischreservierung' })).toBeVisible({
    timeout: ARRIVAL_LIMIT_MS,
  });
  const arrivedAt = Date.now();
  recordTiming('callback-arrival-open-page', arrivedAt - (await committedAtMs(taskId)));

  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Offen');
  expect(
    await page.evaluate(() => performance.getEntriesByName('opened-before-the-call').length),
  ).toBe(1);
  await expect(refresh).toBeFocused();
  // Further polls neither duplicate the card nor bring in the other tenant's task.
  await page.waitForTimeout(SETTLE_MS);
  await expect(card).toHaveCount(1);
  await expect(page.getByText(OTHER_TITLE)).toHaveCount(0);
  expect(consoleErrors).toStrictEqual([]);
});

test('a completion reaches another open session, and a replay of the call does not reopen it', async ({
  browser,
  page,
}) => {
  await signInOwner(page);
  const other = await signInOwnerInNewContext(browser);
  const callSid = `SIM${randomUUID().replaceAll('-', '')}`;
  const utterance = 'Bitte rufen Sie mich zurück wegen einer Tischreservierung.';
  const taskId = await simulateCall(RESTAURANT_NUMBER, utterance, callSid);
  const here = page.getByRole('region', { name: 'Rückrufe' }).locator(`[data-task-id="${taskId}"]`);
  const there = other
    .getByRole('region', { name: 'Rückrufe' })
    .locator(`[data-task-id="${taskId}"]`);
  await expect(here).toBeVisible({ timeout: ARRIVAL_LIMIT_MS });
  await expect(there).toBeVisible({ timeout: ARRIVAL_LIMIT_MS });

  await here.getByRole('button', { name: /^Erledigt/u }).click();
  await expect(page.getByTestId('action-notice')).toHaveText(
    'Der Rückruf ist als erledigt markiert.',
  );
  await expect(here).toHaveCount(0);
  const completedAt = Date.now();
  await expect(there).toHaveCount(0, { timeout: ARRIVAL_LIMIT_MS });
  recordTiming('completion-reaches-other-session', Date.now() - completedAt);
  expect(await taskState(taskId)).toStrictEqual({ status: 'done', version: 4 });

  // The original call arrives again while both pages are open: the next polls leave both alone.
  expect(await simulateCall(RESTAURANT_NUMBER, utterance, callSid)).toBe(taskId);
  await page.waitForTimeout(SETTLE_MS);
  await expect(here).toHaveCount(0);
  await expect(there).toHaveCount(0);
  expect(await taskState(taskId)).toStrictEqual({ status: 'done', version: 4 });
  await other.context().close();
});

test('an outage leaves the list as it is, and the page reconciles when the network returns', async ({
  context,
  page,
}) => {
  await signInOwner(page);
  const callbacks = page.getByRole('region', { name: 'Rückrufe' });
  const first = await simulateCall(
    RESTAURANT_NUMBER,
    'Bitte rufen Sie mich zurück wegen einer Tischreservierung.',
  );
  const firstCard = callbacks.locator(`[data-task-id="${first}"]`);
  await expect(firstCard).toBeVisible({ timeout: ARRIVAL_LIMIT_MS });

  // The browser loses the network; the next poll fails, the owner still sees the same list and no
  // error banner (the page makes no claim it cannot back).
  const pollFailed = page.waitForEvent('requestfailed', {
    predicate: (request) => new URL(request.url()).pathname === '/api/today',
    timeout: ARRIVAL_LIMIT_MS,
  });
  await context.setOffline(true);
  await pollFailed;
  const second = await simulateCall(
    RESTAURANT_NUMBER,
    'Bitte rufen Sie mich zurück wegen einer Tischreservierung.',
  );
  const secondCard = callbacks.locator(`[data-task-id="${second}"]`);
  await expect(firstCard).toBeVisible();
  await expect(secondCard).toHaveCount(0);
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);

  // Back online: the page reads the authoritative state at once, not only what it missed.
  const backAt = Date.now();
  await context.setOffline(false);
  await expect(secondCard).toBeVisible({ timeout: ARRIVAL_LIMIT_MS });
  recordTiming('reconcile-after-network-return', Date.now() - backAt);
  await expect(secondCard).toHaveCount(1);
  await expect(firstCard).toHaveCount(1);
});

test('a revoked session shows the signed-out page and no task data', async ({ page }) => {
  await signInOwner(page);
  const taskId = await simulateCall(
    RESTAURANT_NUMBER,
    'Bitte rufen Sie mich zurück wegen einer Tischreservierung.',
  );
  const card = page.getByRole('region', { name: 'Rückrufe' }).locator(`[data-task-id="${taskId}"]`);
  await expect(card).toBeVisible({ timeout: ARRIVAL_LIMIT_MS });

  // The session ends on the server (sign-out elsewhere, administrator revocation).
  await database.fixturePool().query(
    `update sessions
        set revoked_at = now(), revocation_reason = 'signed_out',
            provider_tokens_sealed = null, provider_tokens_key_id = null
      where revoked_at is null`,
  );
  await expect(page.getByText('Bitte melden Sie sich an')).toBeVisible({
    timeout: ARRIVAL_LIMIT_MS,
  });
  await expect(page.getByRole('link', { name: 'Anmelden' })).toBeVisible();
  await expect(page.locator('[data-task-id]')).toHaveCount(0);
  await expect(page.getByText('Rückruf: Tischreservierung')).toHaveCount(0);
});
