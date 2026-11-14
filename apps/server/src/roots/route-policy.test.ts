import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Controller, Get, Module } from '@nestjs/common';
import { beforeAll, describe, expect } from 'vitest';
import { evidenceTest } from '@moin/testing';
import { CAPABILITIES_KEY } from '../modules/identity-access/http/role.ts';
import type { Capability } from '../modules/identity-access/domain/roles.ts';
import { loadProductionRoots } from '../modules/xsuite/production-roots.ts';
import { controllersReachableFrom, handlersOfController } from '../modules/xsuite/root-routes.ts';
import { ROUTE_POLICY } from './route-policy.ts';

const REPO = resolve(import.meta.dirname, '../../../..');

interface Served {
  readonly key: string;
  readonly capabilities: readonly Capability[];
}

/** Every route the given roots serve, with the capabilities its handler declares. */
function served(roots: readonly unknown[]): Served[] {
  const out: Served[] = [];
  for (const controller of controllersReachableFrom(roots)) {
    for (const route of handlersOfController(controller)) {
      if (route.verb === 'HEAD' || route.verb === 'OPTIONS') continue;
      const capabilities =
        (Reflect.getMetadata(CAPABILITIES_KEY, route.handler) as
          readonly Capability[] | undefined) ??
        (Reflect.getMetadata(CAPABILITIES_KEY, controller) as readonly Capability[] | undefined) ??
        [];
      out.push({ key: `${route.verb} ${route.path}`, capabilities });
    }
  }
  return out;
}

/** What the policy says about a served route, or why it is unclassified. */
function problems(routes: readonly Served[]): string[] {
  const found: string[] = [];
  const keys = new Set(routes.map((route) => route.key));
  for (const route of routes) {
    const policy = ROUTE_POLICY[route.key];
    if (policy === undefined) {
      found.push(`${route.key} is served but has no access policy`);
    } else if ('capabilities' in policy) {
      const live = [...route.capabilities].sort().join(',');
      const pinned = [...policy.capabilities].sort().join(',');
      if (live !== pinned)
        found.push(`${route.key} declares [${live}] but the policy pins [${pinned}]`);
    } else if (route.capabilities.length > 0) {
      found.push(`${route.key} declares capabilities but the policy calls it open`);
    }
  }
  for (const key of Object.keys(ROUTE_POLICY)) {
    if (!keys.has(key)) found.push(`${key} has a policy row but nothing serves it`);
  }
  return found;
}

let apiRoot: unknown;
let voiceRoot: unknown;

beforeAll(async () => {
  const roots = await loadProductionRoots();
  apiRoot = roots.api;
  voiceRoot = roots.voice;
});

describe('the access policy covers every route the production roots serve (P06.07.05)', () => {
  evidenceTest('every served route has exactly one policy row and no row is stale', () => {
    expect(problems(served([apiRoot, voiceRoot]))).toStrictEqual([]);
  });

  evidenceTest('every capability-bearing row names at least one capability', () => {
    for (const [key, policy] of Object.entries(ROUTE_POLICY)) {
      if ('capabilities' in policy) expect(policy.capabilities.length, key).toBeGreaterThan(0);
    }
  });

  evidenceTest('every service-level row names the test that proves its check', () => {
    for (const [key, policy] of Object.entries(ROUTE_POLICY)) {
      if (!('serviceLevel' in policy)) continue;
      const file = resolve(REPO, policy.provenBy);
      expect(existsSync(file), `${key}: ${policy.provenBy} does not exist`).toBe(true);
      const route = key.split(' ')[1] ?? '';
      const stem = route.split('/:')[0] ?? route;
      expect(readFileSync(file, 'utf8'), `${key} is not mentioned in ${policy.provenBy}`).toContain(
        stem,
      );
    }
  });

  evidenceTest(
    'a new controller registered only in the production root is reported (G09 M4)',
    () => {
      @Controller('api/zz-new')
      class ZzNewController {
        // No @Require and no policy row: exactly the route RequireRoleGuard would admit to every role.
        @Get(':id')
        read(): string {
          return 'x';
        }
      }
      @Module({ controllers: [ZzNewController] })
      class ZzNewModule {}
      const mutated = class {};
      Module({ imports: [apiRoot as never, ZzNewModule] })(mutated);
      expect(problems(served([mutated, voiceRoot]))).toStrictEqual([
        'GET /api/zz-new/:id is served but has no access policy',
      ]);
    },
  );

  evidenceTest('a new route in an existing module with the wrong capability is reported', () => {
    // A handler added to a policed controller class path is covered by the same derivation:
    // here a served route whose declared capabilities differ from the pinned row.
    const mismatched = served([apiRoot, voiceRoot]).map((route) =>
      route.key === 'POST /api/members/remove' ? { ...route, capabilities: [] } : route,
    );
    expect(problems(mismatched)).toStrictEqual([
      'POST /api/members/remove declares [] but the policy pins [users:manage]',
    ]);
  });

  evidenceTest('a capability on a route the policy calls open is reported', () => {
    const mismatched = served([apiRoot, voiceRoot]).map((route) =>
      route.key === 'GET /api/today'
        ? { ...route, capabilities: ['users:manage' as const] }
        : route,
    );
    expect(problems(mismatched)).toStrictEqual([
      'GET /api/today declares capabilities but the policy calls it open',
    ]);
  });
});
