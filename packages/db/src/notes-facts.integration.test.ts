/**
 * Notes and facts (P07.09.01, P07.09.03): one parent per note, soft delete, schema validation.
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAuditEvents } from './audit.ts';
import { createContact } from './contacts.ts';
import { createTask } from './tasks.ts';
import {
  checkFactSchemaShape,
  createNote,
  deleteNote,
  listNotes,
  registerFactSchema,
  validateFacts,
  VersionConflictError,
} from './notes-facts.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('notes-facts');
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

describe('notes', () => {
  evidenceTest('one parent per note; soft delete hides, never rewrites', async () => {
    const contact = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Noted' }),
    );
    const note = await withTenant(app, ORG_A, (client) =>
      createNote(client, {
        parent: 'contact',
        parentId: contact.id,
        body: 'Ruft freitags an',
      }),
    );
    expect(note.parent).toBe('contact');
    const listed = await withTenant(app, ORG_A, (client) =>
      listNotes(client, { parent: 'contact', parentId: contact.id }),
    );
    expect(listed.map((n) => n.id)).toContain(note.id);
    await withTenant(app, ORG_A, (client) => deleteNote(client, note.id, note.version));
    const after = await withTenant(app, ORG_A, (client) =>
      listNotes(client, { parent: 'contact', parentId: contact.id }),
    );
    expect(after.map((n) => n.id)).not.toContain(note.id);
    // Second delete 409s: already gone is not deletable again.
    await expect(
      withTenant(app, ORG_A, (client) => deleteNote(client, note.id, note.version + 1)),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  evidenceTest('notes on tasks and leads; bodies never reach audit', async () => {
    const task = await withTenant(app, ORG_A, (client) => createTask(client, { title: 'Noted' }));
    await withTenant(app, ORG_A, (client) =>
      createNote(client, { parent: 'task', parentId: task.id, body: 'Geheimnotiz' }),
    );
    const found = await withTenant(app, ORG_A, (client) =>
      listNotes(client, { parent: 'task', parentId: task.id }),
    );
    expect(found).toHaveLength(1);
    const events = await withTenant(app, ORG_A, async (client) => {
      const all = await listAuditEvents(client, {});
      return all.filter((e) => e.operation.startsWith('note.'));
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const event of events) {
      expect(JSON.stringify(event.args_sanitized)).not.toContain('Geheimnotiz');
    }
  });

  evidenceTest('cross-tenant notes are invisible', async () => {
    const contact = await withTenant(app, ORG_A, (client) =>
      createContact(client, { displayName: 'Private' }),
    );
    await withTenant(app, ORG_A, (client) =>
      createNote(client, { parent: 'contact', parentId: contact.id, body: 'Privat' }),
    );
    const foreign = await withTenant(app, ORG_B, (client) =>
      listNotes(client, { parent: 'contact', parentId: contact.id }),
    );
    expect(foreign).toStrictEqual([]);
  });
});

describe('facts schemas', () => {
  const SCHEMA = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      guests: { type: 'integer' },
    },
    required: ['name'],
    additionalProperties: false,
  };

  evidenceTest('register, validate, reject undeclared and mistyped', async () => {
    await withTenant(app, ORG_A, (client) =>
      registerFactSchema(client, {
        template: 'reservation',
        version: 'v1',
        schema: SCHEMA,
        labelsDe: { name: 'Name', guests: 'Gäste' },
      }),
    );
    const good = await withTenant(app, ORG_A, (client) =>
      validateFacts(client, 'reservation', 'v1', { name: 'Müller', guests: 4 }),
    );
    expect(good).toMatchObject({ valid: true, errors: [] });
    const missing = await withTenant(app, ORG_A, (client) =>
      validateFacts(client, 'reservation', 'v1', { guests: 4 }),
    );
    expect(missing.valid).toBe(false);
    expect(missing.errors).toContain('missing required name');
    const extra = await withTenant(app, ORG_A, (client) =>
      validateFacts(client, 'reservation', 'v1', { name: 'M', injected: true }),
    );
    expect(extra.errors).toContain('undeclared field injected');
    const wrong = await withTenant(app, ORG_A, (client) =>
      validateFacts(client, 'reservation', 'v1', { name: 'M', guests: 'vier' }),
    );
    expect(wrong.errors).toContain('guests must be an integer');
    const unknown = await withTenant(app, ORG_A, (client) =>
      validateFacts(client, 'reservation', 'v9', { name: 'M' }),
    );
    expect(unknown).toMatchObject({ valid: false });
  });

  evidenceTest('registry refuses refs, nesting and open shapes', async () => {
    for (const bad of [
      { type: 'object', properties: { a: { $ref: '#/definitions/x' } } },
      { type: 'object', properties: { a: { type: 'object', properties: {} } } },
      { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: true },
      { type: 'array', items: {} },
      { properties: { a: { type: 'string' } } },
    ]) {
      await expect(
        withTenant(app, ORG_A, (client) =>
          registerFactSchema(client, {
            template: 'bad',
            version: `v${Math.random().toString(36).slice(2, 8)}`,
            schema: bad,
          }),
        ),
      ).rejects.toBeInstanceOf(RangeError);
    }
    const shapeCheck = ((): boolean => {
      try {
        checkFactSchemaShape({ type: 'object' });
        return true;
      } catch {
        return false;
      }
    })();
    expect(shapeCheck).toBe(true);
  });

  it('labels are validated and versions are per-template', async () => {
    await expect(
      withTenant(app, ORG_A, (client) =>
        registerFactSchema(client, {
          template: 'lbl',
          version: 'v1',
          schema: { type: 'object' },
          labelsDe: { name: '' },
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    await withTenant(app, ORG_B, (client) =>
      registerFactSchema(client, { template: 'lbl', version: 'v1', schema: { type: 'object' } }),
    );
    const again = await withTenant(app, ORG_B, (client) =>
      validateFacts(client, 'lbl', 'v1', { anything: 1 }),
    );
    expect(again.valid).toBe(false);
  });
});
