import 'reflect-metadata';
import { bootstrapHttpRole } from './bootstrap.ts';
import { VoiceRootModule } from './roots/voice-root.module.ts';

await bootstrapHttpRole({ rootModule: VoiceRootModule, role: 'voice' });
