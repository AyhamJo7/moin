import { Global, Module, type DynamicModule } from '@nestjs/common';
import { loadConfig, type Config } from './env.ts';

export const CONFIG = Symbol('CONFIG');

/**
 * Configuration is resolved once and shared.
 *
 * `forRoot` exists because the alternative was `loadConfig()` being called twice — once in
 * `bootstrap` to decide whether to start at all, and again in this module's factory — producing
 * two independent frozen objects with nothing guaranteeing they agree. It also gives integration
 * tests a seam: they can supply a configuration without mutating `process.env`, which otherwise
 * makes parallel test files interfere with each other.
 *
 * Global because every module needs it, and threading a configuration object through each one
 * adds no safety.
 */
let resolved: Config | undefined;

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: Config): DynamicModule {
    resolved = config;
    return {
      module: ConfigModule,
      providers: [{ provide: CONFIG, useValue: config }],
      exports: [CONFIG],
      global: true,
    };
  }

  /**
   * Used when a root module imports `ConfigModule` directly rather than through `forRoot`. It
   * reuses what `bootstrap` already resolved, and only falls back to loading if nothing has.
   */
  static forFeature(): DynamicModule {
    const config = resolved ?? loadConfig();
    resolved = config;
    return {
      module: ConfigModule,
      providers: [{ provide: CONFIG, useValue: config }],
      exports: [CONFIG],
      global: true,
    };
  }
}
