/**
 * Prompt/policy registry (P10.06.01/.03/.04, QG-07): content-hash versions are
 * deterministic; the manifest binds the set to its eval report; a version
 * change without an updated report fails the freshness check. Synthetic
 * fixtures only (INV-16).
 */
import { describe, expect, it } from 'vitest';
import { checkEvalFreshness, releaseManifest, versionSet } from './registry.ts';

const SOURCES = {
  prompt: 'Extrahiere Absicht und Slots.',
  policy: 'escalate-on-uncertain',
  template: 'restaurant-v1',
  schema: '{"type":"object"}',
};

describe('prompt and policy registry', () => {
  it('hashes the four texts deterministically; provider/model pass through', () => {
    const a = versionSet('openai-eu', 'gpt-4o-mini-2024-07-18', SOURCES);
    const b = versionSet('openai-eu', 'gpt-4o-mini-2024-07-18', SOURCES);
    expect(a).toStrictEqual(b);
    expect(a.provider).toBe('openai-eu');
    expect(a.model).toBe('gpt-4o-mini-2024-07-18');
    for (const key of ['prompt', 'policy', 'template', 'schema'] as const) {
      expect(a[key]).toMatch(/^[0-9a-f]{12}$/);
    }
    const changed = versionSet('openai-eu', 'gpt-4o-mini-2024-07-18', {
      ...SOURCES,
      prompt: 'Extrahiere Absicht, Slots und Dringlichkeit.',
    });
    expect(changed.prompt).not.toBe(a.prompt);
    expect(changed.policy).toBe(a.policy);
  });

  it('a version change without an updated eval report fails (QG-07)', () => {
    const versions = versionSet('openai-eu', 'gpt-4o-mini-2024-07-18', SOURCES);
    const reportId = `EV-0042-${versions.prompt}.${versions.policy}.${versions.template}.${versions.schema}`;
    expect(checkEvalFreshness(releaseManifest(versions, reportId))).toBe(true);
    // Stale report: prompt text changed, report still names the old hash.
    const stale = versionSet('openai-eu', 'gpt-4o-mini-2024-07-18', {
      ...SOURCES,
      policy: 'escalate-always',
    });
    expect(checkEvalFreshness(releaseManifest(stale, reportId))).toBe(false);
    expect(checkEvalFreshness(releaseManifest(versions, 'EV-0042-unrelated'))).toBe(false);
  });
});
