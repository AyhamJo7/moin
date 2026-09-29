import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.ts';
import { LoggerModule } from '../observability/logger.module.ts';
import { HealthModule } from '../health/health.module.ts';

/**
 * Twilio webhooks and ConversationRelay sessions (P11).
 *
 * Separate from the API role because its failure and scaling characteristics are different: a
 * voice session is a long-lived WebSocket with hard real-time deadlines, and a deploy that
 * interrupts one drops a call a human is on (INV-19).
 */
@Module({ imports: [ConfigModule.forFeature(), LoggerModule, HealthModule] })
export class VoiceRootModule {}
