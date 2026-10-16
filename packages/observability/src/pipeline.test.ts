/**
 * Delivery pipeline (P05.09): shapes hold.
 */
import { describe, expect, it } from 'vitest';
import { buildValid, manifestValid, prodFlow, rollbackValid, stagingFlow } from './pipeline.ts';

describe('delivery-pipeline shapes', () => {
  it('holds build + manifest + rollback shapes', () => {
    expect(buildValid({ byDigest: true, sbom: true, attestation: true })).toBe(true);
    expect(buildValid({ byDigest: true, sbom: false, attestation: true })).toBe(false);
    expect(
      manifestValid({
        digest: 'sha256:1',
        migrations: true,
        versionsPinned: true,
        evalReports: true,
      }),
    ).toBe(true);
    expect(
      manifestValid({ digest: '', migrations: true, versionsPinned: true, evalReports: true }),
    ).toBe(false);
    expect(rollbackValid({ previousDigest: 'sha256:0', automaticOnAlarm: true })).toBe(true);
    expect(rollbackValid({ previousDigest: '', automaticOnAlarm: true })).toBe(false);
  });

  it('orders staging and production flows', () => {
    expect(stagingFlow()).toEqual(['migrate', 'deploy', 'smoke']);
    expect(prodFlow()).toEqual(['migrate', 'deploy', 'smoke', 'watch']);
  });
});
