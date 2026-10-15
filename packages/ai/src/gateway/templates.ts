/**
 * Vertical template system (P10.09, INV-14/18).
 *
 * A template is data: intents with required slots, dialogue policies,
 * response texts, emergency categories. The loader validates a package and
 * content-hashes it (P10.09.02 — `template_versions` persistence rides the
 * DB side separately); `bindTemplate` resolves a tenant binding with bounded
 * overrides (P10.09.03); `lintTemplate` bans tenant-specific code paths
 * (INV-18) and sensitive-use intents (INV-14).
 *
 * The ladder rung: no `templates/<key>/<version>/` directory tree in this
 * slice — the package arrives as a value, and the restaurant v1 skeleton is
 * a constant below (P10.09.05, filled in P12.05). Filesystem loading is
 * P12.05's problem, when the skeleton gets real content.
 */

import { createHash } from 'node:crypto';

export interface TemplateIntent {
  readonly slots: readonly string[];
  readonly required: readonly string[];
  /** Critical intents cannot be disabled by a tenant override. */
  readonly critical: boolean;
}

export interface TemplatePackage {
  readonly key: string;
  readonly version: string;
  readonly intents: Readonly<Record<string, TemplateIntent>>;
  readonly policies: readonly string[];
  readonly responses: Readonly<Record<string, string>>;
  readonly emergencyCategories: readonly string[];
  readonly evalSetRef: string;
}

/** Intents that must never exist (INV-14, PLAN L261). */
export const SENSITIVE_DENYLIST: ReadonlySet<string> = new Set([
  'applicant_scoring',
  'employee_ranking',
  'credit_decision',
  'biometric_id',
  'emotion_recognition',
]);

export interface TenantOverrides {
  readonly disableIntents?: readonly string[];
  readonly wording?: Readonly<Record<string, string>>;
  /** Threshold multipliers must stay within [0.5, 2.0]. */
  readonly thresholds?: Readonly<Record<string, number>>;
}

export interface BoundTemplate {
  readonly key: string;
  readonly version: string;
  readonly contentHash: string;
  readonly enabledIntents: ReadonlySet<string>;
  readonly responses: Readonly<Record<string, string>>;
  readonly emergencyCategories: readonly string[];
}

export function hashTemplate(pkg: TemplatePackage): string {
  return createHash('sha256').update(JSON.stringify(pkg), 'utf8').digest('hex').slice(0, 12);
}

function lintError(pkg: TemplatePackage): string | null {
  for (const name of Object.keys(pkg.intents)) {
    if (SENSITIVE_DENYLIST.has(name)) return `sensitive intent: ${name}`;
    // INV-18: no tenant-specific code paths — intent names are catalogue
    // values, never `tenant_<id>_*`.
    if (name.startsWith('tenant_')) return `tenant-specific intent: ${name}`;
  }
  if (pkg.key.length === 0 || pkg.version.length === 0) return 'missing key or version';
  return null;
}

/** Validate + hash. Returns the error string, or null when valid. */
export function loadTemplate(
  pkg: TemplatePackage,
): { readonly hash: string } | { readonly error: string } {
  const error = lintError(pkg);
  if (error !== null) return { error };
  return { hash: hashTemplate(pkg) };
}

export function bindTemplate(
  pkg: TemplatePackage,
  overrides: TenantOverrides,
): BoundTemplate | { readonly error: string } {
  const loaded = loadTemplate(pkg);
  if ('error' in loaded) return loaded;
  const disable = new Set(overrides.disableIntents ?? []);
  for (const name of disable) {
    const intent = pkg.intents[name];
    if (intent === undefined) return { error: `unknown intent: ${name}` };
    if (intent.critical) return { error: `cannot disable critical intent: ${name}` };
  }
  for (const [k, v] of Object.entries(overrides.thresholds ?? {})) {
    if (!(v >= 0.5 && v <= 2.0)) return { error: `threshold out of bounds: ${k}` };
  }
  const enabled = new Set(Object.keys(pkg.intents).filter((n) => !disable.has(n)));
  return {
    key: pkg.key,
    version: pkg.version,
    contentHash: loaded.hash,
    enabledIntents: enabled,
    responses: { ...pkg.responses, ...(overrides.wording ?? {}) },
    emergencyCategories: pkg.emergencyCategories,
  };
}

/** Restaurant v1 skeleton (P10.09.05 — intents and texts land in P12.05). */
export const RESTAURANT_V1: TemplatePackage = {
  key: 'restaurant',
  version: 'v1',
  intents: {
    faq_hours: { slots: [], required: [], critical: true },
    faq_menu: { slots: [], required: [], critical: false },
    create_callback: { slots: ['callback_phone'], required: ['callback_phone'], critical: false },
  },
  policies: ['escalate-on-uncertain'],
  responses: { greeting: 'Guten Tag, hier ist die Anrufannahme.' },
  emergencyCategories: ['fire', 'medical', 'threat'],
  evalSetRef: 'restaurant-dev-v1',
};
