/**
 * Deterministic identity resolution (P07.03, INV-09, ADR-0016).
 *
 * Pure rules, no model call, no guessing. An inbound identifier normalises through the kernel
 * value objects and matches against verified methods only:
 *
 * - phone: exact E.164 on a verified, non-tenant-owned method whose verification is neither
 *   suspicious nor withheld (withheld/suspicious rows exist but never resolve);
 * - email: exact normalised address on a verified method;
 * - external_id: exact opaque match.
 *
 * One match → link. Zero → `none` verdict (CLIR, unknown: recorded, not linked). Several (only
 * possible for values verified before the partial unique index) → duplicate candidate + review
 * task, link nothing. FS-26 (substituted caller ID) can therefore never merge two callers: the
 * second claimant creates ambiguity, and ambiguity links nobody.
 *
 * Runs inside `withTenant`; every verdict writes an audit row with opaque markers only (INV-12).
 */

import { randomUUID } from 'node:crypto';
import { emailAddress, phoneNumber } from '@moin/kernel';
import { appendAuditEvent } from './audit.ts';
import type { TenantClient } from './tenant.ts';
import type { ContactMethodKind } from './contacts.ts';

export type ResolutionRule = 'none' | 'phone' | 'email' | 'external_id';

const RULE_LABEL_DE: Record<ResolutionRule, string> = {
  none: 'nicht erkannt',
  phone: 'erkannt über Rufnummer',
  email: 'erkannt über E-Mail',
  external_id: 'erkannt über Systemkennung',
};

const RULE_MARKER: Record<ResolutionRule, number> = {
  none: 0,
  phone: 1,
  email: 2,
  external_id: 3,
};

export interface ResolutionVerdict {
  readonly interactionRef: string;
  readonly rule: ResolutionRule;
  readonly labelDe: string;
  readonly contactId: string | null;
  readonly methodId: string | null;
  readonly candidateId: string | null;
}

interface MethodHit extends Record<string, unknown> {
  method_id: string;
  contact_id: string;
  kind: string;
}

async function findVerifiedMethods(
  client: TenantClient,
  kind: ContactMethodKind,
  value: string,
): Promise<MethodHit[]> {
  const result = await client.query<MethodHit>(
    `select id as method_id, contact_id::text, kind from contact_methods
     where kind = $1 and value = $2 and verification = 'verified'
       and is_tenant_owned = false`,
    [kind, value],
  );
  return result.rows;
}

async function recordLink(
  client: TenantClient,
  interactionRef: string,
  rule: ResolutionRule,
  contactId: string,
  methodId: string,
): Promise<ResolutionVerdict> {
  await client.query(
    `insert into interaction_links
       (organisation_id, id, interaction_ref, contact_id, method_id, rule, label_de)
     values (app.current_org(), $1, $2, $3, $4, $5, $6)
     on conflict (organisation_id, interaction_ref) do update
       set contact_id = excluded.contact_id, method_id = excluded.method_id,
           rule = excluded.rule, label_de = excluded.label_de`,
    [randomUUID(), interactionRef, contactId, methodId, rule, RULE_LABEL_DE[rule]],
  );
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'resolution.link',
    targetKind: 'contact',
    targetId: contactId,
    argsSanitized: { rule: RULE_MARKER[rule] },
    result: 'succeeded',
  });
  return {
    interactionRef,
    rule,
    labelDe: RULE_LABEL_DE[rule],
    contactId,
    methodId,
    candidateId: null,
  };
}

async function recordNoMatch(
  client: TenantClient,
  interactionRef: string,
): Promise<ResolutionVerdict> {
  await client.query(
    `insert into interaction_links
       (organisation_id, id, interaction_ref, contact_id, method_id, rule, label_de)
     values (app.current_org(), $1, $2, null, null, 'none', $3)
     on conflict (organisation_id, interaction_ref) do update
       set contact_id = null, method_id = null, rule = 'none', label_de = excluded.label_de`,
    [randomUUID(), interactionRef, RULE_LABEL_DE.none],
  );
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'resolution.no_match',
    targetKind: 'contact',
    argsSanitized: { rule: 0 },
    result: 'succeeded',
  });
  return {
    interactionRef,
    rule: 'none',
    labelDe: RULE_LABEL_DE.none,
    contactId: null,
    methodId: null,
    candidateId: null,
  };
}

async function recordCandidate(
  client: TenantClient,
  interactionRef: string,
  rule: Exclude<ResolutionRule, 'none'>,
  hits: MethodHit[],
): Promise<ResolutionVerdict> {
  const [first, second] = [...hits]
    .map((h) => h.contact_id)
    .sort()
    .slice(0, 2) as [string, string];
  const kind = hits[0]?.kind ?? rule;
  const valueRow = await client.query<{ value: string }>(
    `select value from contact_methods where id = $1`,
    [hits[0]?.method_id ?? null],
  );
  const value = valueRow.rows[0]?.value ?? '';
  const candidateId = randomUUID();
  const taskId = randomUUID();
  await client.query(
    `insert into tasks (organisation_id, id, title, status)
     values (app.current_org(), $1, 'Dubletten prüfen', 'open')`,
    [taskId],
  );
  await client.query(
    `insert into duplicate_candidates
       (organisation_id, id, contact_a_id, contact_b_id, kind, value, status, review_task_id)
     values (app.current_org(), $1, $2, $3, $4, $5, 'open', $6)
     on conflict (organisation_id, kind, value, status) do nothing`,
    [candidateId, first, second, kind, value, taskId],
  );
  await client.query(
    `insert into interaction_links
       (organisation_id, id, interaction_ref, contact_id, method_id, rule, label_de)
     values (app.current_org(), $1, $2, null, null, 'none', $3)
     on conflict (organisation_id, interaction_ref) do update
       set contact_id = null, method_id = null, rule = 'none', label_de = excluded.label_de`,
    [randomUUID(), interactionRef, RULE_LABEL_DE.none],
  );
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'resolution.candidate',
    targetKind: 'contact',
    argsSanitized: { rule: RULE_MARKER[rule] },
    result: 'succeeded',
  });
  return {
    interactionRef,
    rule: 'none',
    labelDe: RULE_LABEL_DE.none,
    contactId: null,
    methodId: null,
    candidateId,
  };
}

async function decide(
  client: TenantClient,
  interactionRef: string,
  rule: Exclude<ResolutionRule, 'none'>,
  hits: MethodHit[],
): Promise<ResolutionVerdict> {
  if (hits.length === 0) return recordNoMatch(client, interactionRef);
  if (hits.length === 1) {
    const hit = hits[0];
    if (hit === undefined) return recordNoMatch(client, interactionRef);
    return recordLink(client, interactionRef, rule, hit.contact_id, hit.method_id);
  }
  return recordCandidate(client, interactionRef, rule, hits);
}

/** Resolve an inbound phone number (E.164 after kernel normalisation) to a contact. */
export async function resolveCaller(
  client: TenantClient,
  interactionRef: string,
  rawPhone: string,
): Promise<ResolutionVerdict> {
  let e164: string;
  try {
    e164 = phoneNumber(rawPhone).e164;
  } catch {
    return recordNoMatch(client, interactionRef);
  }
  return decide(client, interactionRef, 'phone', await findVerifiedMethods(client, 'phone', e164));
}

/** Resolve an inbound email address to a contact. */
export async function resolveEmail(
  client: TenantClient,
  interactionRef: string,
  rawEmail: string,
): Promise<ResolutionVerdict> {
  let value: string;
  try {
    value = emailAddress(rawEmail).value;
  } catch {
    return recordNoMatch(client, interactionRef);
  }
  return decide(client, interactionRef, 'email', await findVerifiedMethods(client, 'email', value));
}

/** Resolve an external system id to a contact. */
export async function resolveExternalId(
  client: TenantClient,
  interactionRef: string,
  externalId: string,
): Promise<ResolutionVerdict> {
  const trimmed = externalId.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return recordNoMatch(client, interactionRef);
  return decide(
    client,
    interactionRef,
    'external_id',
    await findVerifiedMethods(client, 'external_id', trimmed),
  );
}
