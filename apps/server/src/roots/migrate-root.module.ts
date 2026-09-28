import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.ts';
import { LoggerModule } from '../observability/logger.module.ts';

/**
 * The one-shot migration runner (P06).
 *
 * It has no health endpoints on purpose: it is a task that runs to completion and exits, not a
 * service that is polled. Its exit code is the health signal, and it must be the only thing that
 * applies migrations, so a migration can never race a rolling deploy (INV-17, expand/contract).
 */
@Module({ imports: [ConfigModule.forFeature(), LoggerModule] })
export class MigrateRootModule {}
