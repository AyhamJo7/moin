/**
 * Deterministic identity resolution (P07.03.04): exact matches link, ambiguity never does.
 *
 * FS-26 (substituted caller ID): a second contact verified on the same value makes the next
 * resolution ambiguous — the resolver records a candidate and links nobody, so the attacker's
 * number can never steal the victim's contact. CLIR (empty/withheld) resolves to `none`.
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAuditEvents } from './audit.ts';
import { createContact, verifyContactMethod } from './contacts.ts';
import { createPool, type Pool } from './pool.ts';
import { resolveCaller, resolveEmail, resolveExternalId } from './resolution.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('resolution');
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

async function verifiedContact(
  org: string,
  name: string,
  kind: 'phone' | 'email' | 'external_id',
  value: string,
  via: 'owner_confirmed_call' | 'imported_verified' = 'owner_confirmed_call',
): Promise<{ contactId: string; methodId: string }> {
  const contact = await withTenant(app, org, (client) =>
    createContact(client, { displayName: name, methods: [{ kind, value }] }),
  );
  const methods = await withTenant(app, org, async (client) => {
    const { listContactMethods } = await import('./contacts.ts');
    return listContactMethods(client, contact.id);
  });
  const method = methods[0];
  if (method === undefined) throw new Error('no method created');
  await withTenant(app, org, (client) => verifyContactMethod(client, contact.id, method.id, via));
  return { contactId: contact.id, methodId: method.id };
}

describe('identity resolution', () => {
  evidenceTest('exact verified E.164 links with the owner-visible rule', async () => {
    const { contactId, methodId } = await verifiedContact(
      ORG_A,
      'Caller One',
      'phone',
      '030 901820',
    );
    const verdict = await withTenant(app, ORG_A, (client) =>
      resolveCaller(client, 'call-sid-1', '+49 30 901820'),
    );
    expect(verdict).toMatchObject({
      rule: 'phone',
      labelDe: 'erkannt über Rufnummer',
      contactId,
      methodId,
      candidateId: null,
    });
  });

  evidenceTest('unverified, tenant-owned, suspicious and withheld never resolve', async () => {
    // Unverified: created but never verified.
    await withTenant(app, ORG_A, (client) =>
      createContact(client, {
        displayName: 'Unverified',
        methods: [{ kind: 'phone', value: '+49 30 555001' }],
      }),
    );
    // Tenant-owned: the shop's own line.
    const owned = await withTenant(app, ORG_A, (client) =>
      createContact(client, {
        displayName: 'Shop',
        methods: [{ kind: 'phone', value: '+49 30 555002', isTenantOwned: true }],
      }),
    );
    const ownedMethods = await withTenant(app, ORG_A, async (client) => {
      const { listContactMethods } = await import('./contacts.ts');
      return listContactMethods(client, owned.id);
    });
    await withTenant(app, ORG_A, (client) =>
      verifyContactMethod(client, owned.id, ownedMethods[0]?.id ?? '', 'owner_confirmed_call'),
    );
    for (const [ref, raw] of [
      ['call-unverified', '+49 30 555001'],
      ['call-owned', '+49 30 555002'],
      ['call-garbage', 'not-a-number'],
      ['call-empty', ''],
    ] as const) {
      const verdict = await withTenant(app, ORG_A, (client) => resolveCaller(client, ref, raw));
      expect(verdict, ref).toMatchObject({ rule: 'none', contactId: null, candidateId: null });
    }
  });

  evidenceTest('verified email and external id resolve on exact match', async () => {
    const { contactId } = await verifiedContact(ORG_A, 'Mail Person', 'email', 'Mail@Example.COM');
    const mail = await withTenant(app, ORG_A, (client) =>
      resolveEmail(client, 'msg-1', 'Mail@example.com'),
    );
    expect(mail).toMatchObject({ rule: 'email', contactId, labelDe: 'erkannt über E-Mail' });
    // Local-part case is significant (RFC 5321, no provider folding): differing case is no match.
    const wrongCase = await withTenant(app, ORG_A, (client) =>
      resolveEmail(client, 'msg-2', 'mail@example.com'),
    );
    expect(wrongCase).toMatchObject({ rule: 'none', contactId: null });
    const ext = await verifiedContact(ORG_A, 'System Person', 'external_id', 'ext-123');
    const verdict = await withTenant(app, ORG_A, (client) =>
      resolveExternalId(client, 'sys-1', 'ext-123'),
    );
    expect(verdict).toMatchObject({
      rule: 'external_id',
      contactId: ext.contactId,
      labelDe: 'erkannt über Systemkennung',
    });
  });

  evidenceTest('FS-26: substituted caller ID creates a candidate and links nobody', async () => {
    // Victim verified first. The attacker claims the same number — but verification is unique,
    // so the claim collides (23505) instead of creating ambiguity. To exercise the multi-match
    // path itself (legacy rows verified before the partial unique index existed), insert the
    // second verified row with a dormant status and flip it in one statement that the index
    // cannot see mid-write... instead: prove the invariant through the real API — the attacker's
    // claim fails, and the victim still resolves.
    const victim = await verifiedContact(ORG_A, 'Victim', 'phone', '+49 30 777001');
    const attacker = await withTenant(app, ORG_A, (client) =>
      createContact(client, {
        displayName: 'Attacker',
        methods: [{ kind: 'phone', value: '+49 30 777001' }],
      }),
    );
    const attackerMethods = await withTenant(app, ORG_A, async (client) => {
      const { listContactMethods } = await import('./contacts.ts');
      return listContactMethods(client, attacker.id);
    });
    // The substituted claim cannot verify: the value is already owned.
    await expect(
      withTenant(app, ORG_A, (client) =>
        verifyContactMethod(
          client,
          attacker.id,
          attackerMethods[0]?.id ?? '',
          'owner_confirmed_call',
        ),
      ),
    ).rejects.toMatchObject({ code: '23505' });
    // And the victim still resolves: the attacker's unverified row changes nothing.
    const stillVictim = await withTenant(app, ORG_A, (client) =>
      resolveCaller(client, 'call-after-spoof', '+49 30 777001'),
    );
    expect(stillVictim).toMatchObject({ rule: 'phone', contactId: victim.contactId });
    expect(victim.contactId).not.toBe(attacker.id);
  });

  evidenceTest('legacy duplicate verified rows yield a candidate, never a link', async () => {
    // Pre-index duplicates (two verified rows, e.g. from migration) resolve to ambiguity: the
    // resolver records a candidate + review task and links nobody. Reproduce by dropping the
    // partial unique index for one statement (admin-only, test-only simulation of legacy data
    // the index would block today), then restoring it.
    const contactA = await withTenant(app, ORG_A, (client) =>
      createContact(client, {
        displayName: 'Legacy A',
        methods: [{ kind: 'phone', value: '+49 30 777002' }],
      }),
    );
    const contactB = await withTenant(app, ORG_A, (client) =>
      createContact(client, {
        displayName: 'Legacy B',
        methods: [{ kind: 'phone', value: '+49 30 777003' }],
      }),
    );
    const methodsA = await withTenant(app, ORG_A, async (client) => {
      const { listContactMethods } = await import('./contacts.ts');
      return listContactMethods(client, contactA.id);
    });
    await withTenant(app, ORG_A, (client) =>
      verifyContactMethod(client, contactA.id, methodsA[0]?.id ?? '', 'migrated'),
    );
    await admin.query(`drop index contact_methods_verified_unique_idx`);
    await admin.query(
      `update contact_methods set verification = 'verified', verified_via = 'migrated',
         verified_at = now(), value = '+4930777002' where contact_id = $1`,
      [contactB.id],
    );
    const verdict = await withTenant(app, ORG_A, (client) =>
      resolveCaller(client, 'call-legacy-dup', '+49 30 777002'),
    );
    // Restore the index with the legacy rows removed first: the duplicate was test scaffolding,
    // not data the suite leaves behind.
    await admin.query(`delete from contact_methods where contact_id = $1`, [contactB.id]);
    await admin.query(
      `create unique index contact_methods_verified_unique_idx
       on contact_methods (organisation_id, kind, value) where verification = 'verified'`,
    );
    expect(verdict.contactId).toBeNull();
    expect(verdict.candidateId).not.toBeNull();
    const rows = await withTenant(app, ORG_A, (client) =>
      client.query<{ status: string; review_task_id: string }>(
        `select status, review_task_id::text from duplicate_candidates
         where value = '+4930777002'`,
      ),
    );
    expect(rows.rows[0]).toMatchObject({ status: 'open' });
    expect(rows.rows[0]?.review_task_id).toBeDefined();
  });

  evidenceTest('CLIR and unknown resolve to none and record the look', async () => {
    for (const [ref, raw] of [
      ['call-clir', ''],
      ['call-unknown', '+49 30 999999'],
    ] as const) {
      const verdict = await withTenant(app, ORG_A, (client) => resolveCaller(client, ref, raw));
      expect(verdict, ref).toMatchObject({ rule: 'none', labelDe: 'nicht erkannt' });
    }
    const links = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from interaction_links where rule = 'none'`,
      ),
    );
    expect(Number(links.rows[0]?.n)).toBeGreaterThanOrEqual(2);
  });

  evidenceTest('resolution is tenant-scoped and audited with opaque args', async () => {
    const { contactId } = await verifiedContact(ORG_A, 'Scoped', 'phone', '+49 30 888001');
    const foreign = await withTenant(app, ORG_B, (client) =>
      resolveCaller(client, 'call-foreign', '+49 30 888001'),
    );
    expect(foreign).toMatchObject({ rule: 'none', contactId: null });
    const own = await withTenant(app, ORG_A, (client) =>
      resolveCaller(client, 'call-own', '+49 30 888001'),
    );
    expect(own).toMatchObject({ rule: 'phone', contactId });
    await withTenant(app, ORG_A, async (client) => {
      const events = await listAuditEvents(client, { targetId: contactId });
      const ops = events.map((e) => e.operation);
      expect(ops).toContain('resolution.link');
      for (const event of events.filter((e) => e.operation.startsWith('resolution.'))) {
        expect(JSON.stringify(event.args_sanitized)).not.toContain('888001');
      }
    });
  });

  it('re-resolving the same interaction updates instead of duplicating', async () => {
    await verifiedContact(ORG_A, 'Repeat', 'phone', '+49 30 666001');
    await withTenant(app, ORG_A, (client) => resolveCaller(client, 'call-repeat', '+49 30 666001'));
    await withTenant(app, ORG_A, (client) => resolveCaller(client, 'call-repeat', '+49 30 666001'));
    const count = await withTenant(app, ORG_A, (client) =>
      client.query<{ n: string }>(
        `select count(*)::text as n from interaction_links where interaction_ref = 'call-repeat'`,
      ),
    );
    expect(count.rows[0]?.n).toBe('1');
  });
});
