/**
 * The founder's demo, as a test, against the packaged stack (M2D-2): sign in through the real
 * Keycloak at the browser-visible issuer, watch a simulated callback arrive by itself, complete it
 * with Erledigt, and prove the business state survives a reload, an API restart and a stop/start
 * of the whole stack. Synthetic data only; the call is the development simulator, not a telephone.
 *
 * Needs `deploy/demo/demo.sh up` first. The database is read through `docker compose exec`, as
 * the database owner, from this test only.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '../..');
const COMPOSE_FILE = resolve(ROOT, 'deploy/demo/docker-compose.yml');
const DEMO_SH = resolve(ROOT, 'deploy/demo/demo.sh');
const ARRIVAL_LIMIT_MS = 60_000;
const OWNER_EMAIL = 'inhaber@musterrestaurant.example';
const RESTAURANT_NUMBER = '+494033330001';
const CONTRACT_HEADER = 'x-moin-today-contract';

interface Realm {
  users: { email: string; credentials: { value: string }[] }[];
}
const realm = JSON.parse(
  readFileSync(resolve(ROOT, 'docker/keycloak/realm-moin-local.json'), 'utf8'),
) as Realm;
const OWNER_PASSWORD =
  realm.users.find((u) => u.email === OWNER_EMAIL)?.credentials[0]?.value ?? '';

function compose(args: string[], input?: string): string {
  return execFileSync('docker', ['compose', '-p', 'moin-demo', '-f', COMPOSE_FILE, ...args], {
    // The compose file requires the variable to parse; the real value lives in the api container.
    env: { ...process.env, DEMO_SIMULATOR_TOKEN: 'unused' },
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function demoSh(...args: string[]): void {
  execFileSync(DEMO_SH, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 300_000,
  });
}

/** One statement on stdin with psql variables (`:'id'`), never built by interpolation. */
function sql(statement: string, variables: Record<string, string> = {}): string {
  const set = Object.entries(variables).flatMap(([name, value]) => ['-v', `${name}=${value}`]);
  return compose(
    ['exec', '-T', 'postgres', 'psql', '-U', 'moin_owner', '-d', 'moin', '-At', ...set, '-f', '-'],
    statement,
  ).trim();
}

/** The development call simulator, called from inside the api container with its own bearer. */
function simulate(callSid: string, utterance: string): { taskId: string; replayed: boolean } {
  const script = `
    fetch('http://127.0.0.1:3101/api/dev/simulated-calls', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.CALL_SIMULATOR_TOKEN },
      body: JSON.stringify({ callSid: process.env.SID, from: '+4915198765432', to: '${RESTAURANT_NUMBER}', utterance: process.env.TEXT }),
    }).then(async (r) => { console.log(await r.text()); process.exit(r.status < 300 ? 0 : 1); });`;
  const out = compose([
    'exec',
    '-T',
    '-e',
    `SID=${callSid}`,
    '-e',
    `TEXT=${utterance}`,
    'api',
    'node',
    '-e',
    script,
  ]);
  return JSON.parse(out) as { taskId: string; replayed: boolean };
}

const newSid = (): string => `SIM${randomUUID().replaceAll('-', '')}`;

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('link', { name: 'Anmelden' }).click();
  // The real Keycloak, at the issuer the browser can reach (not a container-internal name).
  await expect(page).toHaveURL(/^http:\/\/localhost:8081\/realms\/moin-local\//u);
  await page.locator('#username').fill(OWNER_EMAIL);
  await page.locator('#password').fill(OWNER_PASSWORD);
  await page.locator('#kc-login').click();
  await page.waitForURL('http://localhost:3000/');
}

const callbacks = (page: Page) => page.getByRole('region', { name: 'Rückrufe' });
const card = (page: Page, taskId: string) => callbacks(page).locator(`[data-task-id="${taskId}"]`);

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;
const consoleErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ baseURL: 'http://localhost:3000', locale: 'de-DE' });
  page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
});

test.afterAll(async () => {
  await context.close();
});

test('the packaged owner app serves its scripts and styles and the page is interactive', async () => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  const html = await page.content();
  const assets = [...new Set(html.match(/\/_next\/static\/[^"')\s]+\.(?:js|css)/gu) ?? [])];
  // The owner app styles itself with an inline <style> today; any stylesheet it gains is checked too.
  expect(assets.some((a) => a.endsWith('.js'))).toBe(true);
  for (const asset of assets) {
    const fetched = await page.request.get(asset);
    expect(fetched.status(), asset).toBe(200);
    const type = fetched.headers()['content-type'] ?? '';
    expect(type, asset).toMatch(asset.endsWith('.css') ? /text\/css/u : /javascript/u);
  }
  await expect(page.getByRole('link', { name: 'Anmelden' })).toBeVisible();
  expect((await page.request.get('/api/today')).status()).toBe(401);
});

test('real Keycloak sign-in lands on Heute, and the API speaks the versioned contract', async () => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Heute' })).toBeVisible();
  const versioned = await page.request.get('/api/today', {
    headers: { [CONTRACT_HEADER]: 'versioned' },
  });
  const legacy = await page.request.get('/api/today');
  expect(versioned.status()).toBe(200);
  expect(legacy.status()).toBe(200);
  const tasks = ((await versioned.json()) as { tasks: Record<string, unknown>[] }).tasks;
  expect(tasks.every((t) => Number.isInteger(t['version']))).toBe(true);
  const legacyTasks = ((await legacy.json()) as { tasks: Record<string, unknown>[] }).tasks;
  expect(legacyTasks.every((t) => !('version' in t))).toBe(true);
});

let taskId = '';
let callSid = '';

test('a simulated callback appears by itself, and Erledigt completes it with its audit trail', async () => {
  callSid = newSid();
  const committed = Date.now();
  ({ taskId } = simulate(
    callSid,
    'Bitte rufen Sie mich zurück wegen einer Tischreservierung für Samstag.',
  ));
  await expect(card(page, taskId)).toBeVisible({ timeout: ARRIVAL_LIMIT_MS });
  const arrivedAfter = Date.now() - committed;
  expect(arrivedAfter).toBeLessThan(ARRIVAL_LIMIT_MS);
  test.info().annotations.push({ type: 'arrival-ms', description: String(arrivedAfter) });

  // CSRF is enforced on the packaged stack: the session cookie alone completes nothing.
  const noCsrf = await page.request.post(`/api/tasks/${taskId}/complete`, { data: { version: 1 } });
  expect([401, 403]).toContain(noCsrf.status());
  expect(sql("select status from tasks where id = :'id'", { id: taskId })).toBe('open');

  await card(page, taskId)
    .getByRole('button', { name: /^Erledigt/u })
    .click();
  await expect(page.getByTestId('action-notice')).toHaveText(
    'Der Rückruf ist als erledigt markiert.',
  );
  await expect(card(page, taskId)).toHaveCount(0);
  expect(sql("select status || ' ' || version from tasks where id = :'id'", { id: taskId })).toBe(
    'done 4',
  );
  const actors = sql(
    "select count(*) || ' ' || count(distinct actor_id) from audit_events where target_id = :'id' and operation = 'task.status' and actor_id is not null",
    { id: taskId },
  );
  expect(actors).toBe('3 1');
});

test('the completion survives a reload and an API restart', async () => {
  await page.reload();
  await expect(card(page, taskId)).toHaveCount(0);
  demoSh('restart-api');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Heute' })).toBeVisible();
  await expect(card(page, taskId)).toHaveCount(0);
  expect(sql("select status from tasks where id = :'id'", { id: taskId })).toBe('done');
});

test('a replay of the same call does not reopen the completed work', async () => {
  const again = simulate(
    callSid,
    'Bitte rufen Sie mich zurück wegen einer Tischreservierung für Samstag.',
  );
  expect(again).toStrictEqual({ taskId, replayed: true });
  await page.reload();
  await expect(card(page, taskId)).toHaveCount(0);
  expect(sql("select status || ' ' || version from tasks where id = :'id'", { id: taskId })).toBe(
    'done 4',
  );
});

test('stopping and starting the whole stack keeps the committed work and the sign-in', async () => {
  demoSh('stop');
  demoSh('start');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Heute' })).toBeVisible();
  await expect(card(page, taskId)).toHaveCount(0);
  expect(sql("select status from tasks where id = :'id'", { id: taskId })).toBe('done');
});

test('a second signed-in session sees the same state, live', async ({ browser }) => {
  const second = await browser.newContext({ baseURL: 'http://localhost:3000', locale: 'de-DE' });
  const other = await second.newPage();
  await signIn(other);
  await expect(card(other, taskId)).toHaveCount(0);
  const fresh = simulate(newSid(), 'Guten Tag, bitte um Rückruf wegen einer Geburtstagsfeier.');
  await expect(card(page, fresh.taskId)).toBeVisible({ timeout: ARRIVAL_LIMIT_MS });
  await expect(card(other, fresh.taskId)).toBeVisible({ timeout: ARRIVAL_LIMIT_MS });
  await card(page, fresh.taskId)
    .getByRole('button', { name: /^Erledigt/u })
    .click();
  await expect(card(page, fresh.taskId)).toHaveCount(0);
  await expect(card(other, fresh.taskId)).toHaveCount(0, { timeout: ARRIVAL_LIMIT_MS });

  // The session ends on the server: the open page falls back to signed out and shows no task data.
  const open = simulate(newSid(), 'Bitte rufen Sie mich zurück, Familie Weber.');
  await expect(card(other, open.taskId)).toBeVisible({ timeout: ARRIVAL_LIMIT_MS });
  sql(
    `update sessions set revoked_at = now(), revocation_reason = 'signed_out', provider_tokens_sealed = null, provider_tokens_key_id = null where revoked_at is null`,
  );
  await expect(other.getByText('Bitte melden Sie sich an')).toBeVisible({
    timeout: ARRIVAL_LIMIT_MS,
  });
  await expect(other.locator('[data-task-id]')).toHaveCount(0);
  await expect(other.getByText('Tischreservierung')).toHaveCount(0);
  expect((await other.request.get('/api/today')).status()).toBe(401);
  await second.close();
  // The only console errors are the browser logging the refusals this test causes on purpose: the
  // poll that met the stopped stack (502 from the edge) and the one after the revocation (401).
  // A blocked script, a CSP violation or a hydration error would be something else and fails here.
  expect(consoleErrors.filter((m) => !/status of (?:401|502|503)\b/u.test(m))).toStrictEqual([]);
});
