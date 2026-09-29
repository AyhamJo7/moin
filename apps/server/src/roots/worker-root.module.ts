import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.ts';
import { LoggerModule } from '../observability/logger.module.ts';
import { HealthModule } from '../health/health.module.ts';

/**
 * Queue consumers, timers and the outbox dispatcher (P08).
 *
 * It serves health endpoints but no business HTTP surface: the orchestrator still needs to know
 * whether the process is wedged and whether its dependencies are reachable.
 */
@Module({ imports: [ConfigModule.forFeature(), LoggerModule, HealthModule] })
export class WorkerRootModule {}
