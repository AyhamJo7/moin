/**
 * Reconstructing the URL Twilio signed (P04.04.03).
 *
 * Twilio computes its signature over the absolute URL it requested. Our process does not see that
 * URL: behind an ALB the application receives `/voice/inbound?x=1` and a set of `X-Forwarded-*`
 * headers, and has to rebuild `https://voice.example.de/voice/inbound?x=1` byte for byte. Get the
 * scheme wrong and every legitimate request fails; get the host wrong and the same.
 *
 * ## Why the origin is configuration, not a header
 *
 * The obvious implementation reads `X-Forwarded-Host` and `X-Forwarded-Proto`. Those are headers,
 * and headers are attacker-controllable unless a proxy strips them — which is a property of a
 * deployment, not of this code. An attacker who can choose the host used in the signature base
 * string can make our validator verify a signature for a URL we never served.
 *
 * So the public origin is **configuration**: one value, set per environment, the same value that
 * is registered with Twilio as the webhook URL. Forwarded headers are still read, but only to
 * *compare*: a mismatch means the deployment and the configuration disagree, which is worth an
 * alert and is never worth trusting.
 */

/** A mismatch between the configured origin and what the proxy said. Never fatal by itself. */
export interface OriginMismatch {
  readonly field: 'proto' | 'host';
  readonly configured: string;
  readonly forwarded: string;
}

export interface ReconstructInput {
  /** The configured public origin, e.g. `https://voice.example.de`. No trailing path. */
  readonly publicOrigin: string;
  /** The request target as the framework saw it: path and query, e.g. `/voice/inbound?x=1`. */
  readonly originalUrl: string;
  /** `X-Forwarded-Proto`, if present. Compared, never trusted. */
  readonly forwardedProto?: string | undefined;
  /** `X-Forwarded-Host`, if present. Compared, never trusted. */
  readonly forwardedHost?: string | undefined;
}

export interface ReconstructResult {
  /** The absolute URL to use as the signature base. */
  readonly url: string;
  /** Disagreements between configuration and the proxy. Log these; do not act on them here. */
  readonly mismatches: readonly OriginMismatch[];
}

export class OriginConfigError extends Error {
  public override readonly name = 'OriginConfigError';
}

/**
 * Builds the absolute URL for signature validation.
 *
 * The result preserves the query string exactly as received, including parameter order and any
 * percent-encoding, because the signature was computed over those bytes. Anything that normalises
 * the query here — including a round trip through `URLSearchParams` — breaks validation for the
 * subset of requests where the two spellings differ, which is the worst kind of bug to find.
 */
export function reconstructRequestUrl(input: ReconstructInput): ReconstructResult {
  let origin: URL;
  try {
    origin = new URL(input.publicOrigin);
  } catch {
    throw new OriginConfigError('publicOrigin is not a valid URL');
  }
  if (origin.protocol !== 'https:' && origin.protocol !== 'wss:') {
    throw new OriginConfigError(`publicOrigin must be https: or wss:, not ${origin.protocol}`);
  }
  if (origin.pathname !== '/' || origin.search !== '' || origin.hash !== '') {
    throw new OriginConfigError('publicOrigin must be a bare origin, with no path or query');
  }
  if (!input.originalUrl.startsWith('/')) {
    throw new OriginConfigError('originalUrl must start with "/"');
  }

  const mismatches: OriginMismatch[] = [];
  const configuredProto = origin.protocol.replace(':', '');
  if (input.forwardedProto !== undefined && input.forwardedProto !== '') {
    // A proxy chain may append; the first entry is the client-facing one.
    const first = (input.forwardedProto.split(',')[0] ?? '').trim().toLowerCase();
    if (first !== '' && first !== configuredProto) {
      mismatches.push({ field: 'proto', configured: configuredProto, forwarded: first });
    }
  }
  if (input.forwardedHost !== undefined && input.forwardedHost !== '') {
    const first = (input.forwardedHost.split(',')[0] ?? '').trim().toLowerCase();
    if (first !== '' && first !== origin.host.toLowerCase()) {
      mismatches.push({ field: 'host', configured: origin.host, forwarded: first });
    }
  }

  return {
    url: `${origin.protocol}//${origin.host}${input.originalUrl}`,
    mismatches,
  };
}
