/**
 * Terraform foundation (P05.03): bucket + registry + tags.
 */
import { describe, expect, it } from 'vitest';
import { moduleRegistered, stateBucketValid, tagsValid, TF_MODULES } from './tf-foundation.ts';

describe('terraform foundation shapes', () => {
  it('holds the bootstrap state-bucket shape', () => {
    expect(
      stateBucketValid({ versioning: true, kms: true, objectLock: true, useLockfile: true }),
    ).toBe(true);
    expect(
      stateBucketValid({ versioning: true, kms: false, objectLock: true, useLockfile: true }),
    ).toBe(false);
  });

  it('registers every P05.03.02 module with the tagging standard', () => {
    for (const name of ['network', 'rds', 'valkey', 'sqs-queue', 'waf', 'backup']) {
      expect(moduleRegistered(name), `${name} must be registered`).toBe(true);
    }
    expect(moduleRegistered('nope')).toBe(false);
    expect(TF_MODULES.length).toBe(13);
    expect(
      tagsValid({ env: 'staging', service: 'api', dataClass: 'personal', owner: 'founder' }),
    ).toBe(true);
    expect(tagsValid({ env: '', service: 'api', dataClass: 'personal', owner: 'founder' })).toBe(
      false,
    );
  });
});
