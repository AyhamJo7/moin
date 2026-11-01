import 'reflect-metadata';
import { Controller, Get, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { beforeAll, describe, expect } from 'vitest';
import { evidenceTest } from '@moin/testing';
import { loadProductionRoots } from './production-roots.ts';
import { INVENTORY } from './inventory.ts';
import { compareWithInventory, routesServedBy } from './root-routes.ts';

const inventoried = new Set(INVENTORY.map((r) => `${r.method} ${r.path}`));

/** A feature module added to the API root with a route that reads by id: the leak of mutation A. */
@Controller('api/zz-leak')
class ZzLeakController {
  @Get(':id')
  read(): string {
    return 'x';
  }
}
@Module({ controllers: [ZzLeakController] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- a Nest module is a decorated empty class by design.
class ZzLeakModule {}

/** Mutation A of the round-1 review: the handler lives in a base class, the module is registered
 * only in the production root, and an own-prototype scan sees no routes at all. */
class InheritedLeakBase {
  @Get(':id')
  read(): { foreignTenant: string } {
    return { foreignTenant: 'xsuite-beta' };
  }
  @Get('kept')
  kept(): string {
    return 'base';
  }
  @Get('shadowed/path')
  shadowed(): string {
    return 'base';
  }
}
@Controller('api/zz-inherited')
class InheritedLeakController extends InheritedLeakBase {
  /** An override without decorators: Nest reads the subclass method, finds no route metadata and
   * mounts nothing for this name, so the scanner must not list it either. */
  override shadowed(): string {
    return 'derived';
  }
}
@Module({ controllers: [InheritedLeakController] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- a Nest module is a decorated empty class by design.
class InheritedLeakModule {}

let ApiRootModule: unknown;
let VoiceRootModule: unknown;
let ApiRootWithNewModule: unknown;

@Controller(['api/a', 'api/b'])
class ManyController {
  @Get(['one', 'two'])
  many(): string {
    return 'x';
  }
  @Post()
  root(): string {
    return 'x';
  }
}
@Module({ controllers: [ManyController] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- a Nest module is a decorated empty class by design.
class ManyModule {}
@Module({ imports: [{ module: ManyModule, imports: [], controllers: [] }] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- a Nest module is a decorated empty class by design.
class DynamicHolder {}

describe('routes served by the production root modules', () => {
  beforeAll(async () => {
    const roots = await loadProductionRoots();
    ApiRootModule = roots.api;
    VoiceRootModule = roots.voice;
    // The same API root with one more feature module: mutation A of the G12 review.
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- a Nest module is a decorated empty class by design.
    const mutated = class {};
    Module({ imports: [roots.api, ZzLeakModule] })(mutated);
    ApiRootWithNewModule = mutated;
  });

  evidenceTest('the inventory is exactly what ApiRootModule and VoiceRootModule serve', () => {
    const served = routesServedBy([ApiRootModule, VoiceRootModule]);
    expect(served.size).toBeGreaterThan(0);
    expect(compareWithInventory(served, inventoried)).toStrictEqual({ unprobed: [], orphaned: [] });
  });

  evidenceTest('the real roots serve the known routes and not the hand-registered socket', () => {
    const served = routesServedBy([ApiRootModule, VoiceRootModule]);
    for (const route of [
      'GET /api/today',
      'POST /voice/inbound',
      'GET /healthz',
      'POST /api/auth/step-up',
    ]) {
      expect(served.has(route), route).toBe(true);
    }
    expect(served.has('GET /voice/relay')).toBe(false);
  });

  evidenceTest('a module added to ApiRootModule with an id route is reported as unprobed', () => {
    // Mutation A of the G12 review: the route exists in the production root, the old
    // test-assembled app never mounted it, and the coverage figure stayed green.
    const served = routesServedBy([ApiRootWithNewModule, VoiceRootModule]);
    expect(compareWithInventory(served, inventoried).unprobed).toStrictEqual([
      'GET /api/zz-leak/:id',
    ]);
  });

  evidenceTest('a handler inherited from a base controller is reported as unprobed', () => {
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- a Nest module is a decorated empty class by design.
    const mutated = class {};
    Module({ imports: [ApiRootModule as never, InheritedLeakModule] })(mutated);
    const served = routesServedBy([mutated, VoiceRootModule]);
    expect(compareWithInventory(served, inventoried).unprobed).toStrictEqual([
      'GET /api/zz-inherited/:id',
      'GET /api/zz-inherited/kept',
    ]);
  });

  evidenceTest(
    'the scanner lists exactly the routes Nest mounts for an inherited shape',
    async () => {
      const app = await NestFactory.create<NestFastifyApplication>(
        InheritedLeakModule,
        new FastifyAdapter(),
        { logger: false },
      );
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      try {
        const mounted = async (path: string): Promise<boolean> =>
          (await app.inject({ method: 'GET', url: path })).statusCode === 200;
        expect(await mounted('/api/zz-inherited/42')).toBe(true);
        expect(await mounted('/api/zz-inherited/kept')).toBe(true);
        expect(await mounted('/api/zz-inherited/shadowed/path')).toBe(false);
      } finally {
        await app.close();
      }
      expect([...routesServedBy([InheritedLeakModule])].sort()).toStrictEqual([
        'GET /api/zz-inherited/:id',
        'GET /api/zz-inherited/kept',
      ]);
    },
  );

  evidenceTest('an inventory row that nothing serves is reported as orphaned', () => {
    const withGhost = new Set([...inventoried, 'GET /api/ghost']);
    const served = routesServedBy([ApiRootModule, VoiceRootModule]);
    expect(compareWithInventory(served, withGhost).orphaned).toStrictEqual(['GET /api/ghost']);
  });

  evidenceTest('array prefixes, array paths and dynamic modules are all expanded', () => {
    expect([...routesServedBy([DynamicHolder])].sort()).toStrictEqual([
      'GET /api/a/one',
      'GET /api/a/two',
      'GET /api/b/one',
      'GET /api/b/two',
      'POST /api/a',
      'POST /api/b',
    ]);
  });
});
