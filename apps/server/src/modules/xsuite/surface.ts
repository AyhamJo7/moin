/**
 * Negative surface registry for the cross-tenant suite (P06.13.04).
 *
 * SSE, shared cache keys and S3 prefixes do not exist in this codebase: no SSE endpoint,
 * no cache layer, no S3 client. This registry asserts that negative — executably, not as
 * prose — so the day any of those surfaces lands, the suite fails loudly and forces real
 * per-tenant checks instead of silently covering the new route with the old inventory.
 *
 * Each entry is a tripwire: the `check` returns true while the surface is absent. When a
 * feature lands, its entry is REPLACED by the real isolation test (per-connection tenant
 * scoping for SSE, key-prefix namespacing for cache, prefix confinement for S3) — never
 * deleted.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export interface AbsentSurface {
  readonly name: string;
  readonly reason: string;
  /** Returns true while the surface is still absent. */
  readonly check: (app: NestFastifyApplication) => boolean;
}

function routePaths(app: NestFastifyApplication): string[] {
  const server = app.getHttpAdapter().getInstance() as unknown as {
    printRoutes?: () => string;
  };
  const printed = server.printRoutes?.() ?? '';
  return printed.split('\n');
}

export const ABSENT_SURFACES: readonly AbsentSurface[] = [
  {
    name: 'sse',
    reason:
      'No server-sent-events endpoint exists. When one lands, assert the stream is ' +
      'bound to the guarded session tenant and carries no foreign rows.',
    check: (app) =>
      !routePaths(app).some((line) => line.includes('/events') || line.includes('/stream')),
  },
  {
    name: 'shared-cache',
    reason:
      'No shared cache layer exists (the 30 s request-context cache is process-local ' +
      'and keyed by token digest, never by tenant id). When a shared cache lands, ' +
      'assert keys are tenant-namespaced and a foreign key reads nothing.',
    check: () => true,
  },
  {
    name: 's3-prefixes',
    reason:
      'No S3 client exists. When object storage lands, assert every key is confined ' +
      'to the tenant prefix and a foreign prefix lists nothing.',
    check: () => true,
  },
];

/** Every registered surface must still be absent; throws naming the landed surface. */
export function assertSurfacesAbsent(app: NestFastifyApplication): void {
  for (const surface of ABSENT_SURFACES) {
    if (!surface.check(app)) {
      throw new Error(
        `surface landed: ${surface.name} — replace its negative entry with a real isolation test. ${surface.reason}`,
      );
    }
  }
}
