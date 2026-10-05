import { evidenceTest } from '@moin/testing';
import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './return-path.ts';

describe('the post-sign-in return path', () => {
  it('accepts application paths, with their query', () => {
    expect(safeReturnPath('/')).toBe('/');
    expect(safeReturnPath('/today')).toBe('/today');
    expect(safeReturnPath('/inbox?filter=open&page=2')).toBe('/inbox?filter=open&page=2');
    expect(safeReturnPath('/kunden/%C3%BCbersicht')).toBe('/kunden/%C3%BCbersicht');
  });

  evidenceTest('refuses every way of naming another origin', () => {
    const external = [
      'https://evil.example',
      'http://evil.example/today',
      '//evil.example',
      '//evil.example/today',
      '/\\evil.example',
      '\\\\evil.example',
      '/%5cevil.example',
      '/%5Cevil.example',
      '/%2f%2fevil.example',
      '/%2F%2Fevil.example',
      '/%252f%252fevil.example',
      '/%09/evil.example',
      '/\t/evil.example',
      '/ /evil.example',
      'javascript:alert(1)',
      '/javascript:alert(1)//',
      'JaVaScRiPt:alert(1)',
      'data:text/html,hi',
      'evil.example',
      '',
      '/today?next=https://evil.example',
      '/today?next=//evil.example',
      '/today?next=%2F%2Fevil.example',
      '/today?next=https%3A%2F%2Fevil.example',
      '/a/..//evil.example',
      '/%E0%A4%A',
      `/${'a'.repeat(600)}`,
    ];
    for (const value of external) {
      expect(safeReturnPath(value), value).toBeUndefined();
    }
  });

  it('refuses to send a person back into the sign-in routes', () => {
    expect(safeReturnPath('/api/auth/login')).toBeUndefined();
    expect(safeReturnPath('/API/AUTH/callback?state=x')).toBeUndefined();
    expect(safeReturnPath('/api/%61uth/login')).toBeUndefined();
  });

  evidenceTest('refuses paths that only normalise into the sign-in routes', () => {
    for (const value of [
      '/api/./auth/login',
      '/api/%2e/auth/callback?state=x',
      '/x/../api/auth/login',
      '/%2e%2e/api/auth/x',
    ]) {
      expect(safeReturnPath(value), value).toBeUndefined();
    }
  });

  it('refuses a path that normalisation makes longer than the stored limit', () => {
    expect(safeReturnPath(`/${'"'.repeat(300)}`)).toBeUndefined();
    expect(safeReturnPath(`/?q=${'<'.repeat(400)}`)).toBeUndefined();
    expect(safeReturnPath(`/${'a'.repeat(300)}`)).toBe(`/${'a'.repeat(300)}`);
  });

  it('refuses control characters and non-ASCII written raw', () => {
    expect(safeReturnPath('/today\r\nSet-Cookie: x=1')).toBeUndefined();
    expect(safeReturnPath('/übersicht')).toBeUndefined();
    expect(safeReturnPath('/today%0d%0aSet-Cookie:%20x=1')).toBeUndefined();
  });
});
