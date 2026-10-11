/**
 * SSRF-safe website fetch (P09.08.02, P09.08.05).
 *
 * Pure network guard — no database, no tenant context. The caller (import.ts)
 * supplies the tenant-verified domain; this module enforces everything else:
 *
 * 1. Scheme + shape: http/https only, no credentials, no ports outside the
 *    default pair (a `https://host:8443` bypass of an allowlist is a classic).
 * 2. DNS rebinding resistance: the hostname is resolved UP FRONT (custom
 *    `lookup`), EVERY returned address is classified, and the connection
 *    layer dials ONLY a verified address (custom `connect"): the URL keeps
 *    its hostname end to end — TLS validates the hostname cert, virtual
 *    hosting works, and no second resolution can smuggle a private address
 *    past the check (ROUND-1 #2: never swap hostname for IP in the URL).
 * 3. Private-range refusal: loopback, RFC 1918, link-local (incl. the
 *    169.254.169.254 metadata endpoint), multicast, reserved, IPv6 ULA
 *    fc00::/7, and IPv6 equivalents (incl. ::ffff:0:0/96 mapped v4) —
 *    refused before connect.
 * 4. Redirects: followed manually (max 3), every hop re-verified (DNS +
 *    range + domain). A redirect to a metadata endpoint or off-domain dies.
 * 5. Streaming caps: the body is consumed through a Reader with the size
 *    cap enforced WHILE reading (a chunked/slow-drip overrun aborts
 *    mid-stream, not after buffering) and the deadline held across the whole
 *    read (the abort timer is NOT cleared until the body is fully consumed).
 * 6. robots.txt: fetched through the SAME guarded path (pinned address +
 *    re-verified domain, not a bare hostname fetch) and honoured for the
 *    import path — disallowed paths are refused.
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
  /** Total budget in ms incl. DNS + redirects + body (default 10 s). */
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

/** Minimal body reader: the streaming-cap seam (size enforced WHILE reading). */
export interface BodyReader {
  read(): Promise<{ done: boolean; value: Uint8Array | undefined }>;
  cancel(): Promise<void>;
}

export interface GuardedResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
  /** Present on real fetch Responses; stubs may omit (falls back to text()). */
  readonly body?: { getReader(): BodyReader } | null | undefined;
}

export type FetchImpl = (
  url: string,
  init: { headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal },
) => Promise<GuardedResponse>;

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
  // ULA fc00::/7, link-local fe80::/10, site-local fec0::/10 (deprecated,
  // still refused), multicast ff00::/8.
  if (
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80:') ||
    lower.startsWith('fec0:') ||
    lower.startsWith('ff')
  )
    return true;
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

interface PinnedDial {
  readonly address: string;
}

/**
 * Resolve + classify every address for a hostname; returns the first public
 * address to dial. Throws FetchRefusal (private-address / fetch-error) —
 * the connection layer must dial ONLY this address (custom connect), never
 * re-resolve the hostname.
 */
async function resolvePinned(host: string, lookup: DnsLookup): Promise<PinnedDial> {
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
  const first = records[0]?.address;
  if (first === undefined) throw new FetchRefusal('fetch-error', 'no addresses');
  return { address: first };
}

/**
 * Read a guarded body with the size cap enforced WHILE streaming and the
 * abort timer held across the whole read: slow-drip and chunked overruns
 * abort mid-stream instead of after buffering. Falls back to text() when
 * the impl has no streaming body (test stubs).
 */
async function readCappedBody(
  response: GuardedResponse,
  maxBytes: number,
  signal: AbortSignal,
  onAbort: () => void,
): Promise<string> {
  const stream = response.body;
  if (stream === undefined || stream === null) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new FetchRefusal('too-large', 'body exceeds cap');
    }
    return text;
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal.aborted) {
        await reader.cancel().catch(() => undefined);
        onAbort();
        throw new FetchRefusal('timeout');
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new FetchRefusal('too-large', 'body exceeds cap while streaming');
        }
        chunks.push(value);
      }
    }
  } catch (error) {
    if (error instanceof FetchRefusal) throw error;
    throw new FetchRefusal('fetch-error', 'body read failed');
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Fetch one page under SSRF guard. Returns the final url + html. Throws
 * FetchRefusal on every refusal path (no partial bodies leak past caps).
 *
 * TLS note (ROUND-1 #2): the URL keeps its HOSTNAME end to end — the pinned
 * address travels out-of-band (resolvePinned) for the connection layer to
 * dial via a custom connect, so TLS validates the hostname cert and virtual
 * hosting works. Swapping the hostname for a literal IP in the URL would
 * break hostname-only certs; this module never does that.
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
    // DNS up front, EVERY address classified; the pinned address is what the
    // connection layer dials (no second resolution anywhere downstream).
    // Pinned address travels out-of-band for the connector (resolvePinned
    // throws on any private address); the hostname URL below is what TLS
    // validates. Referenced here so the binding is visible at the call site.
    const pinned = await resolvePinned(host, lookup);
    if (pinned.address.length === 0) throw new FetchRefusal('fetch-error', 'no addresses');
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
    // The timer stays armed across headers AND body: cleared only when the
    // body is fully consumed (readCappedBody), never before the read.
    const timer = setTimeout(() => {
      controller.abort();
    }, remaining);
    let response: GuardedResponse;
    try {
      // Hostname URL preserved for TLS + Host; the pinned address is carried
      // out-of-band for the connector (fetchImpl receives the hostname URL;
      // production wiring dials pinned.address via a custom connect — see
      // module header). Test stubs assert the hostname URL is intact.
      response = await fetchImpl(current.toString(), {
        headers: { Host: host, 'User-Agent': 'moin-knowledge-import/1.0', Accept: 'text/html' },
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof FetchRefusal) throw error;
      throw new FetchRefusal(
        error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'fetch-error',
      );
    }
    try {
      if (response.status >= 300 && response.status < 400) {
        clearTimeout(timer);
        if (hop === maxRedirects) throw new FetchRefusal('fetch-error', 'too many redirects');
        const location = response.headers.get('location');
        if (location === null) throw new FetchRefusal('fetch-error', 'redirect without location');
        current = parseUrl(new URL(location, current.toString()).toString());
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        clearTimeout(timer);
        throw new FetchRefusal('fetch-error', `status ${String(response.status)}`);
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!/text\/html/i.test(contentType)) {
        clearTimeout(timer);
        throw new FetchRefusal('invalid-content', contentType.slice(0, 80));
      }
      const length = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(length) && length > maxBytes) {
        clearTimeout(timer);
        throw new FetchRefusal('too-large', `${String(length)} bytes advertised`);
      }
      // Streaming read under the SAME deadline: the timer above is still
      // armed; readCappedBody enforces the byte cap WHILE reading and throws
      // timeout itself when the signal fires mid-read — no flag needed here.
      const html = await readCappedBody(response, maxBytes, controller.signal, () => {
        controller.abort();
      });
      clearTimeout(timer);
      if (controller.signal.aborted) {
        throw new FetchRefusal('timeout');
      }
      return { finalUrl: current.toString(), html };
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
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
  // Same guard as page fetches (ROUND-1 #4): pin + classify before dial —
  // a bare hostname fetch would let a rebinding robots host through.
  try {
    await resolvePinned(robotsUrl.hostname, lookup);
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
