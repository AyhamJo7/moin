/**
 * Route resolver wiring (P11.02): one platform-owned resolver for the voice
 * module's pre-tenancy dialled-number lookup. Released on shutdown.
 */

import { Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { CONFIG } from '../../config/config.module.ts';
import type { Config } from '../../config/env.ts';
import { createRouteResolver, type RouteResolver } from './route-resolver.ts';

export const ROUTE_RESOLVER = Symbol('ROUTE_RESOLVER');

@Injectable()
class RouteResolverLifecycle implements OnApplicationShutdown {
  constructor(@Inject(ROUTE_RESOLVER) private readonly resolver: RouteResolver) {}

  async onApplicationShutdown(): Promise<void> {
    await this.resolver.end();
  }
}

@Module({
  providers: [
    {
      provide: ROUTE_RESOLVER,
      inject: [CONFIG],
      useFactory: (config: Config): RouteResolver =>
        createRouteResolver(
          config.DATABASE_URL,
          `${config.SERVICE_NAME}-${config.SERVER_ROLE}-route`,
        ),
    },
    RouteResolverLifecycle,
  ],
  exports: [ROUTE_RESOLVER],
})
export class RouteResolverModule {}
