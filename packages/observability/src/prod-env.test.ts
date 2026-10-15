/**
 * Production environment (P17.01): guard blocks, shape holds.
 */
import { describe, expect, it } from 'vitest';
import { prodShapeValid, prodWriteAllowed } from './prod-env.ts';

describe('production environment', () => {
  it('blocks prod writes outside prod', () => {
    expect(prodWriteAllowed('prod')).toBe(true);
    expect(prodWriteAllowed('dev')).toBe(false);
    expect(prodWriteAllowed('staging')).toBe(false);
  });

  it('holds the guarded prod shape', () => {
    expect(
      prodShapeValid({
        account: 'prod-1',
        environment: 'prod',
        multiAz: true,
        alarmsEnabled: true,
      }),
    ).toBe(true);
    expect(
      prodShapeValid({ account: 'prod-1', environment: 'dev', multiAz: true, alarmsEnabled: true }),
    ).toBe(false);
    expect(
      prodShapeValid({
        account: 'prod-1',
        environment: 'prod',
        multiAz: false,
        alarmsEnabled: true,
      }),
    ).toBe(false);
    expect(
      prodShapeValid({ account: '', environment: 'prod', multiAz: true, alarmsEnabled: true }),
    ).toBe(false);
  });
});
