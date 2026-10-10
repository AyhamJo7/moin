/**
 * Contacts and contact methods (P07.02.04): uniqueness per verified method, RLS, 409 on conflict.
 *
 * Runs as `moin_app` inside `withTenant` — the same role and wrapper production uses — with an
 * admin connection for fixtures only. Cross-tenant checks use two organisations so a leak would
 * read real rows, not empty sets.
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAuditEvents } from './audit.ts';
import {
  VersionConflictError,
  addContactMethod,
  createContact,
  listContactMethods,
  listContacts,
  removeContactMethod,
  updateContact,
} from './contacts.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('contacts');
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

describe('contacts', () => {
  evidenceTest('create with methods normalises phone and email', async () => {
    const contact = await withTenant(app, ORG_A, (client) =>
      createContact(client, {
        displayName: 'Jürgen Müller',
        methods: [
          { kind: 'phone', value: '030 901820', verification: 'verified' },
          { kind: 'email', value: 'Hans@Example.COM', verification: 'verified' },
        ],
      }),
    );
    expect(contact.displayName).toBe('Jürgen Müller');
    const methods = await withTenant(app, ORG_A, (client) =>
      listContactMethods(client, contact.id),
    );
    expect(methods.map((m) => m.value).sort()).toStrictEqual(['+4930901820', 'Hans@example.com']);
  });

  evidenceTest('verified values are unique per tenant, unverified are not', async () => {
    const first = await withTenant(app, ORG_A, (client) =>
      createContact(client, {
        displayName: 'First',
        methods: [{ kind: 'phone', value: '+49 30 111111', verification: 'verified' }],
      }),
    );
    // Same verified number on a second contact collides (23505).
    await expect(
      withTenant(app, ORG_A, (client) =>
        createContact(client, {
          displayName: 'Second',
          methods: [{ kind: 'phone', value: '+49 30 111111', verification: 'verified' }],
        }),
      ),
    ).rejects.toMatchObject({ code: '23505' });
    // Unverified duplicates are entry-before-proof: allowed.
    const second = await withTenant(app, ORG_A, (client) =>
      createContact(client, {
        displayName: 'Second',
        methods: [{ kind: 'phone', value: '+49 30 111111' }],
      }),
    );
    expect(second.displayName).toBe('Second');
    expect(first.id).not.toBe(second.id);
  });

  evidenceTest('update bumps version; stale version is a 409 signal', async () => {
    const contact = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Edit Me' }),
    );
    const updated = await withTenant(app, ORG_A, (client) =>
      updateContact(client, contact.id, { displayName: 'Edited', version: contact.version }),
    );
    expect(updated.version).toBe(contact.version + 1);
    await expect(
      withTenant(app, ORG_A, (client) =>
        updateContact(client, contact.id, { displayName: 'Stale', version: contact.version }),
      ),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  evidenceTest('add and remove methods, missing removal is a conflict', async () => {
    const contact = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Methods' }),
    );
    const method = await withTenant(app, ORG_A, (client) =>
      addContactMethod(client, contact.id, { kind: 'email', value: 'a@b.de' }),
    );
    expect(method.kind).toBe('email');
    const removed = await withTenant(app, ORG_A, (client) =>
      removeContactMethod(client, contact.id, method.id),
    );
    expect(removed.kind).toBe('email');
    await expect(
      withTenant(app, ORG_A, (client) => removeContactMethod(client, contact.id, method.id)),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  evidenceTest('cross-tenant rows are invisible and unreachable', async () => {
    const contact = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Private' }),
    );
    // B lists nothing, reads nothing, updates nothing, deletes nothing of A's.
    expect(await withTenant(app, ORG_B, (client) => listContacts(client))).toStrictEqual([]);
    expect(
      await withTenant(app, ORG_B, (client) => listContactMethods(client, contact.id)),
    ).toStrictEqual([]);
    await expect(
      withTenant(app, ORG_B, (client) =>
        updateContact(client, contact.id, { displayName: 'Hijack', version: 1 }),
      ),
    ).rejects.toBeInstanceOf(VersionConflictError);
    await expect(
      withTenant(app, ORG_B, (client) => removeContactMethod(client, contact.id, randomUUID())),
    ).rejects.toBeInstanceOf(VersionConflictError);
    // Composite FK: a method cannot point at another tenant's contact.
    await expect(
      withTenant(app, ORG_B, (client) =>
        addContactMethod(client, contact.id, { kind: 'email', value: 'x@y.de' }),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('lists and searches by name and method value', async () => {
    await withTenant(app, ORG_B, (client) =>
      createContact(client, {
        displayName: 'Suchname Meier',
        methods: [{ kind: 'phone', value: '+49 40 222222', verification: 'verified' }],
      }),
    );
    const byName = await withTenant(app, ORG_B, (client) =>
      listContacts(client, { search: 'uchna' }),
    );
    expect(byName.map((c) => c.displayName)).toContain('Suchname Meier');
    const byNumber = await withTenant(app, ORG_B, (client) =>
      listContacts(client, { search: '40222222' }),
    );
    expect(byNumber.map((c) => c.displayName)).toContain('Suchname Meier');
  });

  evidenceTest('every mutation writes an audit row in the same transaction', async () => {
    const contact = await withTenant(app, ORG_B, (client) =>
      createContact(client, {
        displayName: 'Audited',
        methods: [{ kind: 'phone', value: '+49 40 333333' }],
      }),
    );
    await withTenant(app, ORG_B, async (client) => {
      await updateContact(client, contact.id, { displayName: 'Audited 2', version: 1 });
      const events = await listAuditEvents(client, { targetId: contact.id });
      expect(events.map((e) => e.operation).sort()).toStrictEqual([
        'contact.create',
        'contact.update',
      ]);
      for (const event of events) {
        expect(JSON.stringify(event.args_sanitized)).not.toContain('Audited');
        expect(JSON.stringify(event.args_sanitized)).not.toContain('40333');
      }
    });
  });
});
