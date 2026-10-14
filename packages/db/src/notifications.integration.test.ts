/**
 * Notification model and preferences (P14.01.01/.03): dedup, prefs honoured,
 * urgent bypasses quiet hours only for configured contacts. Synthetic (INV-16).
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { inQuietHours, resolveChannels, triggerNotification } from './notifications.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('notifications');
  app = database.pool();
  admin = createPool({ connectionString: database.migrationUrl, max: 1 });
  await admin.query(
    `insert into organisations (id, slug, name) values ($1, 'alpha', 'Alpha GmbH'), ($2, 'beta', 'Beta GmbH')`,
    [ORG_A, ORG_B],
  );
});

afterAll(async () => {
  await admin.end();
  await database.drop();
});

describe('notifications', () => {
  evidenceTest('dedups repeat triggers on the same key', async () => {
    const refId = randomUUID();
    const first = await withTenant(app, ORG_A, (client) =>
      triggerNotification(client, {
        dedupKey: `task:${refId}:urgent`,
        priority: 'urgent',
        refKind: 'task',
        refId,
      }),
    );
    const second = await withTenant(app, ORG_A, (client) =>
      triggerNotification(client, {
        dedupKey: `task:${refId}:urgent`,
        priority: 'urgent',
        refKind: 'task',
        refId,
      }),
    );
    expect(second).toBe(first);
  });

  evidenceTest('isolates dedup keys per tenant', async () => {
    const refId = randomUUID();
    const key = `task:${refId}:urgent`;
    const a = await withTenant(app, ORG_A, (client) =>
      triggerNotification(client, { dedupKey: key, priority: 'urgent', refKind: 'task', refId }),
    );
    const b = await withTenant(app, ORG_B, (client) =>
      triggerNotification(client, { dedupKey: key, priority: 'urgent', refKind: 'task', refId }),
    );
    expect(b).not.toBe(a);
  });

  evidenceTest('honours prefs: urgent-only, quiet hours, bypass', () => {
    const base = {
      channels: ['inapp', 'email', 'sms'],
      urgentOnly: false,
      quietFrom: '22:00',
      quietTo: '07:00',
      urgentBypass: false,
    } as const;
    // Routine in quiet hours: silent.
    expect(resolveChannels({ ...base, channels: [...base.channels] }, 'routine', '23:00')).toEqual(
      [],
    );
    // Urgent in quiet hours without bypass: silent.
    expect(resolveChannels({ ...base, channels: [...base.channels] }, 'urgent', '23:00')).toEqual(
      [],
    );
    // Urgent in quiet hours with bypass: delivered.
    expect(
      resolveChannels(
        { ...base, channels: [...base.channels], urgentBypass: true },
        'urgent',
        '23:00',
      ),
    ).toEqual(['inapp', 'email', 'sms']);
    // Urgent-only users never get routine, even outside quiet hours.
    expect(
      resolveChannels(
        { ...base, channels: [...base.channels], urgentOnly: true },
        'routine',
        '12:00',
      ),
    ).toEqual([]);
    // Routine outside quiet hours: in-app + email only, never SMS.
    expect(resolveChannels({ ...base, channels: [...base.channels] }, 'routine', '12:00')).toEqual([
      'inapp',
      'email',
    ]);
    expect(inQuietHours({ ...base, channels: [...base.channels] }, '23:00')).toBe(true);
    expect(inQuietHours({ ...base, channels: [...base.channels] }, '12:00')).toBe(false);
  });
});
