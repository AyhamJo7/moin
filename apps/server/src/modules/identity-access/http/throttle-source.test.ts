import { describe, expect } from 'vitest';
import { evidenceTest } from '@moin/testing';
import { throttleSource } from './throttle-source.ts';

describe('the throttle bucket source (G11 M1)', () => {
  evidenceTest('addresses of one IPv6 /64 share a source, however they are written', () => {
    const same = [
      '2001:db8:1:2::1',
      '2001:db8:1:2::2',
      '2001:DB8:1:2::1',
      '2001:db8:1:2:0:0:0:1',
      '2001:db8:1:2:ffff:ffff:ffff:ffff',
    ];
    const sources = new Set(same.map(throttleSource));
    expect([...sources]).toStrictEqual(['v6/64:2001:0db8:0001:0002']);
  });

  evidenceTest('a neighbouring /64 is a different source', () => {
    expect(throttleSource('2001:db8:1:3::1')).not.toBe(throttleSource('2001:db8:1:2::1'));
  });

  evidenceTest('an IPv4-mapped IPv6 address is the IPv4 address', () => {
    expect(throttleSource('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(throttleSource('::FFFF:192.0.2.1')).toBe('192.0.2.1');
    expect(throttleSource('192.0.2.1')).toBe('192.0.2.1');
  });

  evidenceTest('loopback and compressed forms expand', () => {
    expect(throttleSource('::1')).toBe('v6/64:0000:0000:0000:0000');
    expect(throttleSource('fe80::1')).toBe('v6/64:fe80:0000:0000:0000');
  });

  evidenceTest('anything that is not an address is the single invalid source', () => {
    for (const value of [
      '',
      'invalid',
      'a.b.c.d',
      '1.2.3',
      '2001:db8::1::2',
      '12345::1',
      '1.2.3.4.5',
    ]) {
      expect(throttleSource(value), value).toBe('invalid');
    }
  });
});
