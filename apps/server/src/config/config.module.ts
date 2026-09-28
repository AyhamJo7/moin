import { Global, Module } from '@nestjs/common';
import { loadConfig, type Config } from './env.ts';

export const CONFIG = Symbol('CONFIG');

/**
 * Configuration is resolved once, at module construction, and shared.
 *
 * Global because every module needs it and threading a configuration object through each one adds
 * no safety. Resolved eagerly because a configuration error must stop the boot, not surface on
 * the first request that happens to touch the missing value.
 */
@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: (): Config => loadConfig() }],
  exports: [CONFIG],
})
export class ConfigModule {}
