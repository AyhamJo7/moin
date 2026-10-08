/**
 * Two-tenant seeded world for the cross-tenant security suite (P06.13.01).
 *
 * Every tenant table gets rows in BOTH tenants, so every route and every DB probe has
 * something foreign to reach for. Seeding runs as the migration role (the only role that
 * may create organisations and users — P06.04/P06.06 by design); the probes run as
 * `moin_app` through the Nest app or `withTenant`, exactly as traffic does.
 *
 * Tenant tables today (from `apply_tenant_rls` call sites): organisations, locations,
 * tenant_setup, owner_invitation_requests, audit_heads, audit_events, memberships,
 * invitations, support_access_grants. Global tables (users, sessions, auth_transactions)
 * hold the two persons and their sessions instead.
 *
 * Synthetic data only (INV-16): fixed UUIDs and `@example.test` addresses.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from '@moin/db/pool';

export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '22222222-2222-4222-8222-222222222222';

export interface SeededPerson {
  readonly id: string;
  readonly subject: string;
  readonly email: string;
}

export interface SeededTenant {
  readonly organisationId: string;
  readonly slug: string;
  readonly owner: SeededPerson;
  readonly admin: SeededPerson;
  /** A membership id, invitation id, grant id, location id owned by THIS tenant. */
  readonly locationId: string;
  readonly invitationId: string;
  readonly grantId: string;
}

export interface SeededWorld {
  readonly a: SeededTenant;
  readonly b: SeededTenant;
}

function person(prefix: string): SeededPerson {
  const subject = randomUUID();
  return {
    id: randomUUID(),
    subject,
    email: `${prefix}-${subject.slice(0, 8)}@example.test`,
  };
}

/**
 * Seed two fully populated tenants. Idempotent per database (fixed ids): safe to call
 * once per file in `beforeAll`. Every insert is migration-role DDL-adjacent fixture
 * setup, never application traffic.
 */
export async function seedTwoTenants(admin: Pool): Promise<SeededWorld> {
  const ownerA = person('xsuite-a-owner');
  const adminA = person('xsuite-a-admin');
  const ownerB = person('xsuite-b-owner');
  const adminB = person('xsuite-b-admin');

  for (const p of [ownerA, adminA, ownerB, adminB]) {
    await admin.query(
      'insert into users (id, cognito_sub, email, status) values ($1, $2, $3, $4)',
      [p.id, p.subject, p.email, 'active'],
    );
  }

  async function seedTenant(
    organisationId: string,
    slug: string,
    name: string,
    owner: SeededPerson,
    adminPerson: SeededPerson,
  ): Promise<SeededTenant> {
    await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
      organisationId,
      slug,
      name,
    ]);
    const locationId = randomUUID();
    await admin.query('insert into locations (organisation_id, id, name) values ($1, $2, $3)', [
      organisationId,
      locationId,
      `${name} HQ`,
    ]);
    await admin.query(
      'insert into memberships (organisation_id, id, user_id, role, status) values ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
      [
        organisationId,
        randomUUID(),
        owner.id,
        'owner',
        'active',
        organisationId,
        randomUUID(),
        adminPerson.id,
        'admin',
        'active',
      ],
    );
    const invitationId = randomUUID();
    await admin.query(
      `insert into invitations (organisation_id, id, email, role, token_hash, expires_at, created_by)
       values ($1, $2, $3, $4, $5, clock_timestamp() + interval '7 days', $6)`,
      [
        organisationId,
        invitationId,
        `invited-${slug}@example.test`,
        'staff',
        Buffer.alloc(32, 1),
        owner.id,
      ],
    );
    const grantId = randomUUID();
    await admin.query(
      `insert into support_access_grants (organisation_id, id, operator_subject, scope, reason, expires_at, created_by)
       values ($1, $2, $3, $4, $5, clock_timestamp() + interval '24 hours', $6)`,
      [
        organisationId,
        grantId,
        `operator-${slug}`,
        'readonly',
        'cross-tenant suite fixture grant',
        owner.id,
      ],
    );
    // Setup + owner-invitation-request rows: one per tenant (UNIQUE organisation_id).
    // Audit heads/events arrive through the writers under test, not the seed.
    await admin.query(
      `insert into tenant_setup (organisation_id, template_ref)
       values ($1, 'restaurant@1.0')`,
      [organisationId],
    );
    await admin.query(
      `insert into owner_invitation_requests (organisation_id, email)
       values ($1, $2)`,
      [organisationId, `owner-${slug}@example.test`],
    );
    return { organisationId, slug, owner, admin: adminPerson, locationId, invitationId, grantId };
  }

  const a = await seedTenant(TENANT_A, 'xsuite-alpha', 'Xsuite Alpha GmbH', ownerA, adminA);
  const b = await seedTenant(TENANT_B, 'xsuite-beta', 'Xsuite Beta GmbH', ownerB, adminB);
  return { a, b };
}
