/**
 * Data services (P05.07): shapes-valid.
 */
import { describe, expect, it } from 'vitest';
import {
  bucketValid,
  encryptionAtRest,
  queueValid,
  rdsValid,
  sesValid,
  valkeyValid,
} from './data-services.ts';

describe('data-services shapes', () => {
  it('validates each service shape', () => {
    expect(
      rdsValid({ engineVersion: '17', forceSsl: true, kms: true, deletionProtectionProd: true }),
    ).toBe(true);
    expect(
      rdsValid({ engineVersion: '16', forceSsl: true, kms: true, deletionProtectionProd: true }),
    ).toBe(false);
    expect(valkeyValid({ tls: true, auth: true })).toBe(true);
    expect(valkeyValid({ tls: true, auth: false })).toBe(false);
    expect(queueValid({ kms: true, dlq: true })).toBe(true);
    expect(bucketValid({ blockPublic: true, kms: true, versioning: true })).toBe(true);
    expect(sesValid({ dkim: true, spf: true, dmarc: true })).toBe(true);
    expect(sesValid({ dkim: true, spf: false, dmarc: true })).toBe(false);
  });

  it('enforces encryption at rest everywhere', () => {
    const rds = { engineVersion: '17', forceSsl: true, kms: true, deletionProtectionProd: true };
    const valkey = { tls: true, auth: true };
    const queue = { kms: true, dlq: true };
    const bucket = { blockPublic: true, kms: true, versioning: true };
    expect(encryptionAtRest(rds, valkey, queue, bucket)).toBe(true);
    expect(encryptionAtRest({ ...rds, kms: false }, valkey, queue, bucket)).toBe(false);
  });
});
