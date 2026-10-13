/**
 * Prompt and policy registry (P10.06.01/.03, QG-07).
 *
 * A version set names the exact prompt, policy, template and schema versions
 * behind a model call. Content hashes (not sequence numbers) so two checkouts
 * with the same files agree without a database:
 * - `versionSet` — hash the four prompt/policy/template/schema texts.
 * - `releaseManifest` — the active set plus its eval report ID (P10.06.03).
 * - `checkEvalFreshness` — a version change without an updated eval report
 *   fails (P10.06.04): the manifest's report must name the active set.
 *
 * P10.06.02 (ai_actions version columns) is a migration and rides separately —
 * this module defines the `VersionRef` shape that migration will store.
 */

import { createHash } from 'node:crypto';

/** What every ai_actions row will record (P10.06.02, INV-10). */
export interface VersionRef {
  readonly provider: string;
  readonly model: string;
  readonly prompt: string;
  readonly policy: string;
  readonly template: string;
  readonly schema: string;
}

/** The four hashed texts that define a releasable AI configuration. */
export interface VersionSetSources {
  readonly prompt: string;
  readonly policy: string;
  readonly template: string;
  readonly schema: string;
}

export interface ReleaseManifest {
  readonly versions: VersionRef;
  /** Eval report ID bound to this exact set (QG-07). */
  readonly evalReportId: string;
}

function hash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
}

/** Hash the four texts; provider/model travel unchanged from config. */
export function versionSet(
  provider: string,
  model: string,
  sources: VersionSetSources,
): VersionRef {
  return {
    provider,
    model,
    prompt: hash(sources.prompt),
    policy: hash(sources.policy),
    template: hash(sources.template),
    schema: hash(sources.schema),
  };
}

export function releaseManifest(versions: VersionRef, evalReportId: string): ReleaseManifest {
  return { versions, evalReportId };
}

/**
 * The manifest's report must name the active set, else CI fails (QG-07).
 * The report ID convention is `<...>-<prompt>.<policy>.<template>.<schema>`
 * so the check is a suffix match, not a registry lookup.
 */
export function checkEvalFreshness(manifest: ReleaseManifest): boolean {
  const v = manifest.versions;
  const suffix = `${v.prompt}.${v.policy}.${v.template}.${v.schema}`;
  return manifest.evalReportId.endsWith(suffix);
}
