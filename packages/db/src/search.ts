/**
 * Tenant search over contacts, tasks and notes (P07.12, LAUNCH tier).
 *
 * One query per scope, all through withTenant — RLS scopes every hit, so a search can
 * never return another tenant's rows (proven by the cross-tenant test, not by trust).
 * Input is validated and parameterised, never interpolated: FTS goes through
 * `plainto_tsquery('german', $n)`, trgm through `similarity()` / `%` with a bound
 * parameter. The audit row carries the query LENGTH bucket and the scope marker only —
 * the query text itself never reaches an audit row (INV-12).
 *
 * Ranking: FTS `ts_rank_cd` first (exact stem hits), trgm similarity as the tiebreak
 * for name/phone scopes. Cursor pagination is `(rank, id)`-ordered with a limit cap;
 * the cursor is the last row's `(score, id)` pair, opaque to callers.
 */

import { appendAuditEvent } from './audit.ts';
import type { TenantClient } from './tenant.ts';

export type SearchScope = 'contacts' | 'tasks' | 'notes' | 'all';

const SCOPE_MARKER: Record<SearchScope, number> = { contacts: 0, tasks: 1, notes: 2, all: 3 };

const MAX_QUERY_LENGTH = 200;
const MAX_LIMIT = 50;

export interface SearchHit {
  readonly scope: 'contact' | 'task' | 'note';
  readonly id: string;
  readonly title: string;
  readonly score: number;
}

export interface SearchPage {
  readonly hits: readonly SearchHit[];
  readonly nextCursor: string | null;
}

function checkQuery(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) throw new RangeError('search query is empty');
  if (trimmed.length > MAX_QUERY_LENGTH) throw new RangeError('search query too long');
  // LIKE metacharacters are literal text here, not wildcards — the service adds its own
  // `%` wrapper for the trgm leg, so escape the caller's.
  return trimmed.replace(/[%_\\]/gu, (c) => `\\${c}`);
}

interface Cursor {
  readonly score: string;
  readonly id: string;
}

function parseCursor(cursor: string | undefined): Cursor | null {
  if (cursor === undefined) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new RangeError('bad search cursor');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new RangeError('bad search cursor');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new RangeError('bad search cursor');
  const { score, id } = parsed as { score?: unknown; id?: unknown };
  if (typeof score !== 'string' || typeof id !== 'string')
    throw new RangeError('bad search cursor');
  return { score: score, id: id };
}

function encodeCursor(score: number, id: string): string {
  // Scores arrive as float8 text ('2.100000001490116') while the cursor param binds
  // as float4-cast float ('2.1') — the two never compare equal, so the (score, id)
  // tiebreak never fires and pages replay. The cursor therefore carries the score's
  // full-precision TEXT form, and SQL compares score::text — text equality on the
  // rendered value, immune to float width mismatches.
  return Buffer.from(JSON.stringify({ score: String(score), id }), 'utf8').toString('base64url');
}

async function searchContacts(
  client: TenantClient,
  query: string,
  limit: number,
  cursor: Cursor | null,
): Promise<SearchHit[]> {
  // FTS leg (german stemming + ß-folding) UNION trgm leg (fuzzy names: unaccent
  // folded at query time — unaccent is STABLE so it cannot live in the index
  // expression; the lower() trgm index prunes, similarity rechecks) UNION phone-digit
  // leg (partial value match). UNION (not UNION ALL) dedupes only FULL-row matches —
  // a row matching FTS and trgm with different scores appears TWICE, once per band.
  // The outer query therefore collapses to the best score per id (MAX + GROUP BY)
  // before the cursor predicate, so each contact ranks once and pages advance.
  const result = await client.query<{ id: string; title: string; score: string }>(
    `select id::text, max(title) as title, max(score)::text as score from (
       select c.id as id, c.display_name as title,
         ts_rank_cd(to_tsvector('german', c.display_name),
           plainto_tsquery('german', $1)) + 2 as score
       from contacts c
       where to_tsvector('german', c.display_name) @@ plainto_tsquery('german', $1)
       union all
       select c.id, c.display_name,
         similarity(public.unaccent(lower(c.display_name)), public.unaccent(lower($1))) + 1 as score
       from contacts c
       where similarity(public.unaccent(lower(c.display_name)), public.unaccent(lower($1))) > 0.2
       union all
       select c.id, c.display_name, 0.4 as score
       from contacts c
       where exists (
         select 1 from contact_methods m
         where m.contact_id = c.id and m.organisation_id = c.organisation_id
           and replace(replace(replace(m.value, ' ', ''), '-', ''), '+', '') ilike '%' || replace(replace($1, ' ', ''), '-', '') || '%' escape '\\'
       )
     ) hits
     group by id
     having ($2::text is null or max(score)::text < $2::text
       or (max(score)::text = $2::text and id::text > $3::text))
     order by max(score) desc, id limit $4`,
    [query, cursor?.score ?? null, cursor?.id ?? null, limit + 1],
  );
  return result.rows.map((r) => ({
    scope: 'contact' as const,
    id: r.id,
    title: r.title,
    score: Number(r.score),
  }));
}

async function searchTasks(
  client: TenantClient,
  query: string,
  limit: number,
  cursor: Cursor | null,
): Promise<SearchHit[]> {
  const result = await client.query<{ id: string; title: string; score: string }>(
    `select t.id::text, t.title,
       ts_rank_cd(to_tsvector('german', t.title), plainto_tsquery('german', $1)) as score
     from tasks t
     where to_tsvector('german', t.title) @@ plainto_tsquery('german', $1)
       and ($2::text is null or ts_rank_cd(to_tsvector('german', t.title),
         plainto_tsquery('german', $1))::text < $2::text
         or (ts_rank_cd(to_tsvector('german', t.title), plainto_tsquery('german', $1))::text = $2::text
           and t.id::text > $3::text))
     order by score desc, t.id limit $4`,
    [query, cursor?.score ?? null, cursor?.id ?? null, limit + 1],
  );
  return result.rows.map((r) => ({
    scope: 'task' as const,
    id: r.id,
    title: r.title,
    score: Number(r.score),
  }));
}

async function searchNotes(
  client: TenantClient,
  query: string,
  limit: number,
  cursor: Cursor | null,
): Promise<SearchHit[]> {
  const result = await client.query<{ id: string; title: string; score: string }>(
    `select n.id::text, left(n.body, 120) as title,
       ts_rank_cd(to_tsvector('german', n.body), plainto_tsquery('german', $1)) as score
     from notes n
     where n.deleted_at is null
       and to_tsvector('german', n.body) @@ plainto_tsquery('german', $1)
       and ($2::text is null or ts_rank_cd(to_tsvector('german', n.body),
         plainto_tsquery('german', $1))::text < $2::text
         or (ts_rank_cd(to_tsvector('german', n.body), plainto_tsquery('german', $1))::text = $2::text
           and n.id::text > $3::text))
     order by score desc, n.id limit $4`,
    [query, cursor?.score ?? null, cursor?.id ?? null, limit + 1],
  );
  return result.rows.map((r) => ({
    scope: 'note' as const,
    id: r.id,
    title: r.title,
    score: Number(r.score),
  }));
}

/**
 * Search one scope (or all) with cursor pagination. The audit row records the query
 * LENGTH and the scope marker — never the query text (INV-12: queries contain names,
 * numbers, free text).
 */
export async function searchTenant(
  client: TenantClient,
  input: {
    query: string;
    scope?: SearchScope | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
  },
): Promise<SearchPage> {
  const query = checkQuery(input.query);
  const scope = input.scope ?? 'all';
  const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_LIMIT);
  const cursor = parseCursor(input.cursor);
  const [contacts, tasks, notes] = await Promise.all([
    scope === 'tasks' || scope === 'notes'
      ? Promise.resolve([] as SearchHit[])
      : searchContacts(client, query, limit, scope === 'all' ? null : cursor),
    scope === 'contacts' || scope === 'notes'
      ? Promise.resolve([] as SearchHit[])
      : searchTasks(client, query, limit, scope === 'all' ? null : cursor),
    scope === 'contacts' || scope === 'tasks'
      ? Promise.resolve([] as SearchHit[])
      : searchNotes(client, query, limit, scope === 'all' ? null : cursor),
  ]);
  // `all` merges three ranked lists: re-sort by score, cut at the limit. Single scopes
  // keep their SQL order and paginate by cursor; merged `all` does not paginate (a
  // merged cursor across three independent rankings would lie about completeness).
  // Strict `<` on the score (not `<=` with an id tiebreak): the tiebreak compares a
  // float score against a text id across UNION legs with different score domains, and
  // mixed-type equality never matches twice — pages overlap instead of advancing.
  const merged = [...contacts, ...tasks, ...notes].sort((a, b) =>
    b.score === a.score ? (a.id < b.id ? -1 : 1) : b.score - a.score,
  );
  const page = scope === 'all' ? merged.slice(0, limit) : merged.slice(0, limit);
  const hasMore = merged.length > limit;
  const last = page[page.length - 1];
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'search.query',
    targetKind: 'search',
    argsSanitized: { query_len: query.length, scope: SCOPE_MARKER[scope] },
    result: 'succeeded',
  });
  return {
    hits: page,
    nextCursor:
      scope === 'all' || !hasMore || last === undefined ? null : encodeCursor(last.score, last.id),
  };
}
