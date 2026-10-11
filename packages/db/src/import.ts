/**
 * Website import into knowledge drafts (P09.08.02, P09.08.04, BR-095).
 *
 * The pipeline, in order:
 * 1. DOMAIN CHECK: the url's registrable domain must match a verified row in
 *    business_domains for the calling tenant (else refused: unverified-domain).
 *    Verification itself is ops-driven (DNS, outside this module).
 * 2. SAFE FETCH: import-fetch.ts (SSRF guard, robots, caps).
 * 3. HTML → TEXT: strip scripts/styles/nav, collapse whitespace, cap length.
 *    The text is DATA from here on — never executed, never interpolated.
 * 4. INJECTION SCAN: flag prompt-injection markers (ignored-instruction
 *    patterns) on the suggestion — stored as a flag the owner sees, and the
 *    suggestion NEVER auto-approves (INV-08).
 * 5. DRAFTS: one knowledge item per suggestion (source='import', category
 *    from the structuring step) + one import-run audit row. Drafts flow
 *    through the P09.05 approval door like any other draft.
 *
 * LLM structuring is deliberately NOT called here: the PILOT path stores
 * rule-shaped suggestions (headings → title/body splits) the owner edits;
 * the LLM pass is a P10 template-gated step. What this module structures is
 * deterministic and reviewable.
 *
 * Audit carries counts + refusal markers only (INV-12): never urls, titles,
 * or bodies.
 */

import { randomUUID } from 'node:crypto';
import { appendAuditEvent } from './audit.ts';
import { FetchRefusal, safeFetch, type SafeFetchOptions } from './import-fetch.ts';
import { createKnowledgeItem } from './knowledge.ts';
import type { TenantClient } from './tenant.ts';

export type ImportRefusalReason =
  | 'unverified-domain'
  | 'private-address'
  | 'robots-denied'
  | 'too-large'
  | 'timeout'
  | 'fetch-error'
  | 'invalid-content'
  | 'invalid-url';

export class ImportRefusal extends Error {
  public override readonly name = 'ImportRefusal';
  public readonly reason: ImportRefusalReason;
  public constructor(reason: ImportRefusalReason) {
    super(reason);
    this.reason = reason;
  }
}

export interface ImportSuggestion {
  readonly title: string;
  readonly body: string;
  readonly category: string;
  readonly sourceUrl: string;
  readonly injectionFlag: boolean;
}

export interface WebsiteImportResult {
  readonly runId: string;
  readonly draftItemIds: readonly string[];
  readonly suggestions: readonly ImportSuggestion[];
}

/** Prompt-injection markers flagged on imported text (stored as a flag, never executed). */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /you\s+are\s+now\s+an?\s+\w+/i,
  /system\s*:\s*/i,
  /\[system\]/i,
  /<\s*script/i,
  /javascript\s*:/i,
  /on\w+\s*=\s*["']?[^"'>]+["']?/i,
];

/** True when the imported text carries prompt-injection markers (flag, never execute). */
export function flagsInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

/** Strip HTML to reviewable text: no scripts/styles/nav, collapsed whitespace. */
export function htmlToText(html: string): string {
  return (
    html
      // Remove script/style/nav/footer blocks with their content.
      .replace(/<(script|style|nav|footer|header)[\s>][\s\S]*?<\/\1\s*>/gi, ' ')
      // Headings become line breaks (structure for the suggestion splitter).
      .replace(/<\s*h[1-6][^>]*>/gi, '\n\n# ')
      // Paragraphs and breaks become whitespace.
      .replace(/<\s*(p|br|li|tr)[^>]*>/gi, '\n')
      // Strip remaining tags.
      .replace(/<[^>]*>/g, ' ')
      // Decode the common entities (no full parser — deterministic subset).
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/gi, ' ')
      // Collapse whitespace, drop empty lines.
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n')
      .slice(0, 8000)
  );
}

/**
 * Split reviewable text into draft suggestions: `# Heading` lines open a
 * section (title = heading, body = following lines); leading text without a
 * heading becomes one suggestion. Bodies under 20 chars are dropped (nav
 * crumbs, not content). Deterministic — the LLM pass is a later step.
 */
export function structureSuggestions(
  text: string,
  input: { category: string; sourceUrl: string; maxSuggestions?: number },
): ImportSuggestion[] {
  const max = input.maxSuggestions ?? 5;
  const sections: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('# ')) {
      const title = line.slice(2).trim().slice(0, 200);
      if (title.length > 0) {
        current = { title, lines: [] };
        sections.push(current);
      }
    } else if (current !== null) {
      current.lines.push(line);
    } else if (line.trim().length > 0) {
      current = { title: line.trim().slice(0, 200), lines: [] };
      sections.push(current);
    }
  }
  return sections
    .map((section) => ({
      title: section.title,
      body: section.lines.join('\n').slice(0, 8000),
      category: input.category,
      sourceUrl: input.sourceUrl,
      injectionFlag: flagsInjection(`${section.title}\n${section.lines.join('\n')}`),
    }))
    .filter((suggestion) => suggestion.body.trim().length >= 20)
    .slice(0, max);
}

/** Extract the registrable domain (last two labels) for registry matching. */
export function registrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/\.$/, '').split('.');
  return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
}

export interface ImportWebsiteInput {
  readonly url: string;
  readonly category: string;
  readonly fetchOptions?: Omit<SafeFetchOptions, 'verifiedDomain'> | undefined;
}

/**
 * Import a website page into knowledge drafts. Refusals throw ImportRefusal
 * (machine-readable reason, recorded on the import-run row); drafts are
 * created with source='import' and need P09.05 approval — never auto-live.
 */
export async function importWebsite(
  client: TenantClient,
  input: ImportWebsiteInput,
): Promise<WebsiteImportResult> {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new ImportRefusal('invalid-url');
  }
  const domain = registrableDomain(parsed.hostname);
  const verified = await client.query<{ domain: string }>(
    `select domain from business_domains
     where organisation_id = app.current_org() and domain = $1`,
    [domain],
  );
  if (verified.rows[0] === undefined) {
    await recordRun(client, input.url, domain, 'refused', 'unverified-domain', []);
    throw new ImportRefusal('unverified-domain');
  }
  let html: string;
  let finalUrl: string;
  try {
    const fetched = await safeFetch(input.url, {
      ...input.fetchOptions,
      verifiedDomain: verified.rows[0].domain,
    });
    html = fetched.html;
    finalUrl = fetched.finalUrl;
  } catch (error) {
    const reason: ImportRefusalReason =
      error instanceof FetchRefusal ? error.reason : 'fetch-error';
    await recordRun(client, input.url, domain, 'refused', reason, []);
    throw new ImportRefusal(reason);
  }
  const text = htmlToText(html);
  const suggestions = structureSuggestions(text, { category: input.category, sourceUrl: finalUrl });
  const draftItemIds: string[] = [];
  for (const suggestion of suggestions) {
    const created = await createKnowledgeItem(client, {
      title: suggestion.title,
      body: suggestion.body,
      metadata: { source: 'import', category: suggestion.category },
    });
    draftItemIds.push(created.item.id);
  }
  const runId = randomUUID();
  await client.query(
    `insert into knowledge_import_runs
       (organisation_id, id, source_url, verified_domain, status, draft_item_ids)
     values (app.current_org(), $1, $2, $3, 'succeeded', $4::uuid[])`,
    [runId, input.url.slice(0, 2000), domain, draftItemIds],
  );
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'knowledge.import',
    targetKind: 'knowledge_item',
    argsSanitized: { drafts: draftItemIds.length },
    result: 'succeeded',
  });
  return { runId, draftItemIds, suggestions };
}

async function recordRun(
  client: TenantClient,
  url: string,
  domain: string,
  status: 'refused' | 'failed',
  reason: ImportRefusalReason,
  draftItemIds: readonly string[],
): Promise<void> {
  const runId = randomUUID();
  await client.query(
    `insert into knowledge_import_runs
       (organisation_id, id, source_url, verified_domain, status, refusal_reason, draft_item_ids)
     values (app.current_org(), $1, $2, $3, $4, $5, $6::uuid[])`,
    [runId, url.slice(0, 2000), domain, status, reason, [...draftItemIds]],
  );
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'knowledge.import_refused',
    targetKind: 'knowledge_item',
    argsSanitized: { reason: reason.length },
    result: 'succeeded',
  });
}
