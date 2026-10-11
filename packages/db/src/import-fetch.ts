/**
 * SSRF-safe website fetch (P09.08.02, P09.08.05).
 *
 * Pure network guard — no database, no tenant context. The caller (import.ts)
 * supplies the tenant-verified domain; this module enforces everything else:
 *
 * 1. Scheme + shape: http/https only, no credentials, no ports outside the
 *    default pair (a `https://host:8443` bypass of an allowlist is a classic).
 * 2. DNS rebinding resistance: the hostname is resolved UP FRONT (custom
 *    `lookup`), EVERY returned address is classified, and the fetch connects
 *    to a pinned literal IP (no second resolution inside undici). A hostname
 *    whose DNS flips between resolve and connect cannot smuggle a private
 *    address past the check.
 * 3. Private-range refusal: loopback, RFC 1918, link-local (incl. the
 *    169.254.169.254 metadata endpoint), multicast, reserved, and IPv6
 *    equivalents (incl. ::ffff:0:0/96 mapped v4) — refused before connect.
 * 4. Redirects: followed manually (max 3), every hop re-verified (DNS +
 *    range + domain). A redirect to a metadata endpoint or off-domain dies.
 * 5. Caps: response body capped at 1 MiB (oversized → refused before parse),
 *    total time capped at 10 s (incl. DNS + redirects).
 * 6. robots.txt: fetched from the same verified origin (same guards) and
 *    honoured for the import path — disallowed paths are refused.
 *
 * All refusals are typed FetchRefusal errors (machine-readable reason for
 * the import audit trail) — never raw exceptions, never response bodies.
 */

import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';

/** Machine-readable refusal reasons (import audit trail + tests). */
export type FetchRefusalReason =
  | 'invalid-url'
  | 'unverified-domain'
  | 'private-address'
  | 'robots-denied'
  | 'too-large'
  | 'timeout'
  | 'fetch-error'
  | 'invalid-content';

export class FetchRefusal extends Error {
  public override readonly name = 'FetchRefusal';
  public readonly reason: FetchRefusalReason;
  public constructor(reason: FetchRefusalReason, detail?: string) {
    super(detail === undefined ? reason : `${reason}: ${detail}`);
    this.reason = reason;
  }
}

export interface SafeFetchOptions {
  /** Registrable domain the url must belong to (tenant-verified registry). */
  readonly verifiedDomain: string;
  /** Raw response cap in bytes (default 1 MiB). */
  readonly maxBytes?: number | undefined;
  /** Total budget in ms incl. DNS + redirects (default 10 s). */
  readonly timeoutMs?: number | undefined;
  /** Maximum redirect hops, every hop re-verified (default 3). */
  readonly maxRedirects?: number | undefined;
  /** DNS lookup (injectable for tests — default node:dns). */
  readonly lookup?: DnsLookup | undefined;
  /** Fetch implementation (injectable for tests — default global fetch). */
  readonly fetchImpl?: FetchImpl | undefined;
  /** robots.txt body for this origin (injectable — default: fetched live). */
  readonly robotsTxt?: string | undefined;
}

export interface FetchedPage {
  readonly finalUrl: string;
  readonly html: string;
}

export type DnsLookup = (
  hostname: string,
  options: { all: true },
) => Promise<readonly { address: string; family: number }[]>;

export type FetchImpl = (
  url: string,
  init: { headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/** Default DNS lookup via node:dns (all addresses — rebinding check needs all). */
const defaultLookup: DnsLookup = (hostname, options) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { ...options, verbatim: true }, (error, addresses) => {
      if (error !== null) reject(error);
      else resolve(addresses);
    });
  });

const MAX_BYTES_DEFAULT = 1_048_576;
const TIMEOUT_MS_DEFAULT = 10_000;
const MAX_REDIRECTS_DEFAULT = 3;

/** True when the literal IP must never be dialled (SSRF suite pins each). */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return true;
  if (family === 4) {
    const [a = 0, b = 0, c = 0, d = 0] = ip.split('.').map(Number);
    return (
      a === 127 || // loopback
      a === 10 || // RFC 1918
      (a === 172 && b >= 16 && b <= 31) || // RFC 1918
      (a === 192 && b === 168) || // RFC 1918
      (a === 169 && b === 254) || // link-local incl. metadata endpoint
      (a >= 224 && a <= 239) || // multicast
      (a === 0 && b === 0 && c === 0 && d === 0) || // unspecified
      a >= 240 || // reserved
      (a === 192 && b === 0 && c === 2) || // TEST-NET-1 (docs)
      (a === 198 && b === 51 && c === 100) || // TEST-NET-2
      (a === 203 && b === 0 && c === 113) // TEST-NET-3
    );
  }
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fec0:') || lower.startsWith('ff')) return true;
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped: dotted form re-enters the v4 classifier; the (rare) fully
    // hex form has no public range — treat as private (fail closed).
    const mapped = lower.slice('::ffff:'.length);
    if (mapped.includes('.')) return isPrivateAddress(mapped);
    return true;
  }
  return false;
}

/** Registrable-domain containment: sub-domains allowed, siblings not. */
export function belongsToDomain(hostname: string, verifiedDomain: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const domain = verifiedDomain.toLowerCase().replace(/\.$/, '');
  return host === domain || host.endsWith(`.${domain}`);
}

function parseUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new FetchRefusal('invalid-url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new FetchRefusal('invalid-url', 'scheme must be http or https');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new FetchRefusal('invalid-url', 'credentials in url');
  }
  if (parsed.port !== '' && parsed.port !== '80' && parsed.port !== '443') {
    throw new FetchRefusal('invalid-url', 'non-default port');
  }
  return parsed;
}

/** Minimal robots.txt honouring for one path (Allow/Disallow longest-match). */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  let longestAllow = -1;
  let longestDeny = -1;
  let inGlobal = false;
  for (const raw of robotsTxt.split('\n')) {
    const line = raw.split('#')[0]?.trim() ?? '';
    if (/^user-agent\s*:/i.test(line)) {
      inGlobal = /user-agent\s*:\s*\*/i.test(line);
      continue;
    }
    if (!inGlobal) continue;
    const allow = /^allow\s*:\s*(\S*)/i.exec(line)?.[1] ?? null;
    if (allow !== null) {
      if (allow === '' || path.startsWith(allow))
        longestAllow = Math.max(longestAllow, allow.length);
      continue;
    }
    const deny = /^disallow\s*:\s*(\S*)/i.exec(line)?.[1] ?? null;
    if (deny !== null && deny !== '' && path.startsWith(deny)) {
      longestDeny = Math.max(longestDeny, deny.length);
    }
  }
  return longestAllow >= longestDeny;
}

/**
 * Fetch one page under SSRF guard. Returns the final url + html. Throws
 * FetchRefusal on every refusal path (no partial bodies leak past caps).
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<FetchedPage> {
  const maxBytes = options.maxBytes ?? MAX_BYTES_DEFAULT;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS_DEFAULT;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS_DEFAULT;
  const lookup = options.lookup ?? defaultLookup;
  const fetchImpl =
    options.fetchImpl ??
    ((
      url: string,
      init: { headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal },
    ) => fetch(url, init));
  const deadline = Date.now() + timeoutMs;
  let current = parseUrl(rawUrl);
  let robotsCheckedOrigin = '';
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const host = current.hostname;
    if (!belongsToDomain(host, options.verifiedDomain)) {
      throw new FetchRefusal('unverified-domain', host);
    }
    // DNS up front, EVERY address classified (rebinding resistance).
    let records: readonly { address: string; family: number }[];
    try {
      records = await lookup(host, { all: true });
    } catch {
      throw new FetchRefusal('fetch-error', 'dns failed');
    }
    if (records.length === 0) throw new FetchRefusal('fetch-error', 'no addresses');
    for (const record of records) {
      if (isPrivateAddress(record.address)) {
        throw new FetchRefusal('private-address', record.address);
      }
    }
    // Pin the first public address: connect to the literal IP (Host header
    // preserves virtual hosting; no second resolution inside the fetch).
    const origin = `${current.protocol}//${host}`;
    if (origin !== robotsCheckedOrigin) {
      const robotsBody =
        options.robotsTxt ??
        (await fetchRobots(origin, options.verifiedDomain, lookup, fetchImpl, deadline));
      if (!robotsAllows(robotsBody, current.pathname)) {
        throw new FetchRefusal('robots-denied', current.pathname);
      }
      robotsCheckedOrigin = origin;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new FetchRefusal('timeout');
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, remaining);
    let response: {
      status: number;
      headers: { get(name: string): string | null };
      text(): Promise<string>;
    };
    try {
      const ip = records[0]?.address ?? host;
      const pinned = new URL(current.toString());
      // Only literal-IP hosts skip re-resolution; hostnames pin record[0].
      if (isIP(host) === 0) {
        pinned.hostname = ip;
      }
      response = await fetchImpl(pinned.toString(), {
        headers: { Host: host, 'User-Agent': 'moin-knowledge-import/1.0', Accept: 'text/html' },
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof FetchRefusal) throw error;
      throw new FetchRefusal(
        error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'fetch-error',
      );
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      if (hop === maxRedirects) throw new FetchRefusal('fetch-error', 'too many redirects');
      const location = response.headers.get('location');
      if (location === null) throw new FetchRefusal('fetch-error', 'redirect without location');
      current = parseUrl(new URL(location, current.toString()).toString());
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new FetchRefusal('fetch-error', `status ${String(response.status)}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!/text\/html/i.test(contentType)) {
      throw new FetchRefusal('invalid-content', contentType.slice(0, 80));
    }
    const length = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(length) && length > maxBytes) {
      throw new FetchRefusal('too-large', `${String(length)} bytes advertised`);
    }
    const html = await response.text();
    if (Buffer.byteLength(html, 'utf8') > maxBytes) {
      throw new FetchRefusal('too-large', 'body exceeds cap');
    }
    return { finalUrl: current.toString(), html };
  }
  throw new FetchRefusal('fetch-error', 'redirect loop exhausted');
}

async function fetchRobots(
  origin: string,
  verifiedDomain: string,
  lookup: DnsLookup,
  fetchImpl: FetchImpl,
  deadline: number,
): Promise<string> {
  const robotsUrl = new URL('/robots.txt', origin);
  if (!belongsToDomain(robotsUrl.hostname, verifiedDomain)) return '';
  try {
    const records = await lookup(robotsUrl.hostname, { all: true });
    for (const record of records) {
      if (isPrivateAddress(record.address)) return '';
    }
  } catch {
    return '';
  }
  const remaining = deadline - Date.now();
  if (remaining <= 0) return '';
  const controller = new AbortController();
  const timer = setTimeout(
    () => {
      controller.abort();
    },
    Math.min(remaining, 3000),
  );
  try {
    const response = await fetchImpl(robotsUrl.toString(), {
      headers: { 'User-Agent': 'moin-knowledge-import/1.0' },
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status < 200 || response.status >= 300) return '';
    const body = await response.text();
    return body.slice(0, 32_768);
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}
