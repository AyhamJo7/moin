import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.ts';
import { LoggerModule } from '../observability/logger.module.ts';
import { HealthModule } from '../health/health.module.ts';

/**
 * The owner-facing HTTP API.
 *
 * One image is built per release and started with a different command per role (INV-17), so each
 * root module loads only the module graph its role needs: the voice role must not drag in the
 * whole API surface, and the worker must not open an HTTP listener it never serves.
 *
 * The business modules (identity-access, tenancy, audit, contacts, conversations, work, …) are
 * added by the phases that build them, P06 onward.
 */
@Module({ imports: [ConfigModule.forFeature(), LoggerModule, HealthModule] })
export class ApiRootModule {}
