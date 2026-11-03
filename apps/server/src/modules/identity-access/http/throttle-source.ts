/**
 * The bucket key of a request source (P06.12.01, security acceptance G11 M1).
 *
 * A bucket per full IPv6 address gives one host that owns a /64 about 2^64 fresh budgets, so the
 * source is reduced to the unit an attacker cannot cheaply multiply: an IPv6 address becomes its
 * /64 prefix, an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) becomes the IPv4 address, and the
 * text form is canonical (lower case, fully expanded), so `2001:DB8:1:2::1` and
 * `2001:db8:1:2:0:0:0:1` land in the same bucket. Anything that is not an address stays the single
 * `invalid` bucket, as before.
 */

import { isIPv4, isIPv6 } from 'node:net';

const INVALID = 'invalid';
const IPV6_GROUPS = 8;
const PREFIX_GROUPS = 4;
const HEX_GROUP = 16;
const GROUP_WIDTH = 4;
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** Expands an IPv6 address to eight 16-bit groups, or undefined when it is not one. */
function expand(address: string): number[] | undefined {
  // An embedded dotted quad (`::ffff:1.2.3.4`) is two groups.
  let text = address.toLowerCase();
  const quad = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (quad !== null) {
    const [a, b, c, d] = quad.slice(1).map(Number) as [number, number, number, number];
    const high = ((a << 8) | b).toString(HEX_GROUP);
    const low = ((c << 8) | d).toString(HEX_GROUP);
    text = `${text.slice(0, quad.index)}${high}:${low}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] === '' ? [] : (halves[0] ?? '').split(':');
  const tail = halves.length === 2 && halves[1] !== '' ? (halves[1] ?? '').split(':') : [];
  const missing = IPV6_GROUPS - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const parsed = groups.map((group) => Number.parseInt(group, HEX_GROUP));
  return parsed.length === IPV6_GROUPS && parsed.every((n) => Number.isInteger(n) && n >= 0)
    ? parsed
    : undefined;
}

/** The canonical bucket source of `address`, or `invalid`. */
export function throttleSource(address: string): string {
  const mapped = IPV4_MAPPED.exec(address);
  if (mapped !== null && isIPv4(mapped[1] ?? '')) return mapped[1] ?? INVALID;
  if (isIPv4(address)) return address;
  if (!isIPv6(address)) return INVALID;
  const groups = expand(address);
  if (groups === undefined) return INVALID;
  const prefix = groups
    .slice(0, PREFIX_GROUPS)
    .map((group) => group.toString(HEX_GROUP).padStart(GROUP_WIDTH, '0'));
  return `v6/64:${prefix.join(':')}`;
}
