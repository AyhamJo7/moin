/** Tenant-scoped audit queries and chain verification (P06.10, INV-10). */
import { createHash, randomUUID } from 'node:crypto';
import { currentTenant, type TenantClient } from './tenant.ts';

const AUDIT_PAGE_SIZE = 1000;
const SHA256_BYTES = 32;
const MAX_AUDIT_QUERY_LIMIT = 100;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface AuditEventInput {
  readonly source: 'api' | 'voice' | 'worker' | 'operator' | 'provisioning' | 'system';
  readonly operation: string;
  readonly targetKind: string;
  readonly targetId?: string;
  readonly versions?: Readonly<Record<string, string>>;
  readonly validation?: Readonly<Record<string, boolean | number>>;
  readonly argsSanitized?: Readonly<Record<string, string | number | boolean>>;
  readonly result: 'succeeded' | 'failed' | 'rejected' | 'unknown';
  readonly approvalId?: string;
  readonly traceId?: string;
}

/** Call in the same withTenant transaction as the business operation being recorded. */
export async function appendAuditEvent(
  client: TenantClient,
  event: AuditEventInput,
): Promise<string> {
  const context = currentTenant();
  if (context === undefined) throw new Error('audit writer requires tenant context');
  const result = await client.query<{ seq: string }>(
    `select app.append_audit_event(
       $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::uuid,
       $7::jsonb, $8::jsonb, $9::jsonb, $10::text, $11::uuid, $12::uuid, $13::text
     )::text as seq`,
    [
      randomUUID(),
      context.actorId ?? null,
      event.source,
      event.operation,
      event.targetKind,
      event.targetId ?? null,
      JSON.stringify(event.versions ?? {}),
      JSON.stringify(event.validation ?? {}),
      JSON.stringify(event.argsSanitized ?? {}),
      event.result,
      event.approvalId ?? null,
      context.correlationId ?? null,
      event.traceId ?? null,
    ],
  );
  const seq = result.rows[0]?.seq;
  if (seq === undefined) throw new Error('audit writer returned no sequence');
  return seq;
}

export interface AuditQuery {
  readonly targetKind?: string;
  readonly targetId?: string;
  readonly actorId?: string;
  readonly correlationId?: string;
  readonly afterSeq?: string;
  readonly limit?: number;
}

export interface AuditEvent extends Record<string, unknown> {
  readonly id: string;
  readonly seq: string;
  readonly actor_id: string | null;
  readonly source: string;
  readonly operation: string;
  readonly target_kind: string;
  readonly target_id: string | null;
  readonly versions: Record<string, unknown>;
  readonly validation: Record<string, unknown>;
  readonly args_sanitized: Record<string, unknown>;
  readonly result: string;
  readonly approval_id: string | null;
  readonly correlation_id: string | null;
  readonly trace_id: string | null;
  readonly created_at: Date;
}

/** Tenant RLS applies to this paged feed; filters are values, never SQL identifiers. */
export async function listAuditEvents(
  client: TenantClient,
  query: AuditQuery = {},
): Promise<readonly AuditEvent[]> {
  if (currentTenant() === undefined) throw new Error('audit query requires tenant context');
  const limit = query.limit ?? MAX_AUDIT_QUERY_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_AUDIT_QUERY_LIMIT ||
    (query.afterSeq !== undefined &&
      (!/^(0|[1-9][0-9]{0,18})$/u.test(query.afterSeq) ||
        BigInt(query.afterSeq) > MAX_POSTGRES_BIGINT)) ||
    (query.targetKind !== undefined && !/^[a-z][a-z0-9_]{0,63}$/u.test(query.targetKind)) ||
    [query.targetId, query.actorId, query.correlationId].some(
      (id) => id !== undefined && !UUID.test(id),
    )
  ) {
    throw new Error('invalid audit query');
  }
  const result = await client.query<AuditEvent>(
    `select id, seq::text, actor_id, source, operation, target_kind, target_id,
       versions, validation, args_sanitized, result, approval_id, correlation_id,
       trace_id, created_at
     from audit_events
     where ($1::text is null or target_kind = $1)
       and ($2::uuid is null or target_id = $2)
       and ($3::uuid is null or actor_id = $3)
       and ($4::uuid is null or correlation_id = $4)
       and seq > $5::bigint
     order by seq asc limit $6`,
    [
      query.targetKind ?? null,
      query.targetId ?? null,
      query.actorId ?? null,
      query.correlationId ?? null,
      query.afterSeq ?? '0',
      limit,
    ],
  );
  return result.rows;
}

interface AuditRow extends Record<string, unknown> {
  readonly seq: string;
  readonly prev_hash: Buffer;
  readonly hash: Buffer;
  readonly canonical_payload: string;
  readonly rebuilt_payload: string;
}

interface HeadRow extends Record<string, unknown> {
  readonly last_seq: string;
  readonly last_hash: Buffer;
  /** The highest sequence actually present, read in the same snapshot as the head. */
  readonly max_seq: string | null;
}

export type AuditChainResult =
  | { readonly valid: true; readonly checked: string }
  | {
      readonly valid: false;
      readonly checked: string;
      readonly reason: string;
      readonly seq: string;
    };

/**
 * Check every event through the head captured at entry. Later appends do not create false alarms:
 * existing audit rows cannot be changed, and the captured head names an immutable prefix.
 */
export async function verifyAuditChain(client: TenantClient): Promise<AuditChainResult> {
  if (currentTenant() === undefined) throw new Error('audit verification requires tenant context');
  // The head and the highest present sequence are read in **one statement**, so they come from one
  // snapshot. Two statements would let an append that commits in between look like an event past
  // the head, and a false integrity alarm is a very expensive thing to cry wolf about.
  const heads = await client.query<HeadRow>(
    `select last_seq, last_hash,
       (select max(seq)::text from audit_events) as max_seq
     from audit_heads`,
  );
  const head = heads.rows[0];
  if (head === undefined) {
    const orphan = await client.query('select 1 from audit_events limit 1');
    return orphan.rows.length === 0
      ? { valid: true, checked: '0' }
      : { valid: false, checked: '0', reason: 'missing-head', seq: '1' };
  }

  const finalSeq = BigInt(head.last_seq);
  // Anything beyond the head is invisible to the walk below, which is what makes both a forged
  // insert and a rolled-back head cheap attacks: the walk simply stops before reaching them. A head
  // reset to 0 with events still present is the same finding, which is why one check covers both.
  if (head.max_seq !== null && BigInt(head.max_seq) > finalSeq) {
    return {
      valid: false,
      checked: '0',
      reason: 'event-past-head',
      seq: head.max_seq,
    };
  }

  let seq = 0n;
  let previous: Buffer = Buffer.alloc(SHA256_BYTES);
  while (seq < finalSeq) {
    const rows = await client.query<AuditRow>(
      `select seq, prev_hash, hash, canonical_payload,
        app.audit_canonical_payload(
          organisation_id, seq, id, actor_id, source, operation, target_kind, target_id,
          versions, validation, args_sanitized, result, approval_id, correlation_id,
          trace_id, created_at
        ) as rebuilt_payload
       from audit_events where seq > $1 and seq <= $2 order by seq limit $3`,
      [seq.toString(), finalSeq.toString(), AUDIT_PAGE_SIZE],
    );
    if (rows.rows.length === 0) {
      return {
        valid: false,
        checked: seq.toString(),
        reason: 'missing-event',
        seq: (seq + 1n).toString(),
      };
    }
    for (const row of rows.rows) {
      const current = BigInt(row.seq);
      if (current !== seq + 1n) {
        return {
          valid: false,
          checked: seq.toString(),
          reason: 'sequence-gap',
          seq: current.toString(),
        };
      }
      if (!row.prev_hash.equals(previous)) {
        return {
          valid: false,
          checked: seq.toString(),
          reason: 'previous-hash',
          seq: current.toString(),
        };
      }
      if (row.canonical_payload !== row.rebuilt_payload) {
        return {
          valid: false,
          checked: seq.toString(),
          reason: 'payload-mismatch',
          seq: current.toString(),
        };
      }
      const expected = createHash('sha256')
        .update(previous)
        .update(row.canonical_payload, 'utf8')
        .digest();
      if (!row.hash.equals(expected)) {
        return {
          valid: false,
          checked: seq.toString(),
          reason: 'hash-mismatch',
          seq: current.toString(),
        };
      }
      previous = row.hash;
      seq = current;
    }
  }
  if (!previous.equals(head.last_hash)) {
    return { valid: false, checked: seq.toString(), reason: 'head-mismatch', seq: seq.toString() };
  }
  return { valid: true, checked: seq.toString() };
}
