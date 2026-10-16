/**
 * The simulated-call entry point (M1 vertical slice): development and test only.
 *
 * Mounted in the api root always, inert unless `CALL_SIMULATOR_TOKEN` is configured — which the
 * configuration loader allows only in development and test, for the api role. The dialled-number
 * lookup is the same platform route resolver the voice role uses.
 */

import { Module } from '@nestjs/common';
import { RouteResolverModule } from '../platform/route-resolver.module.ts';
import { WorkModule } from '../work/work.module.ts';
import { CallSimulatorController } from './http/call-simulator.controller.ts';
import { SimulatorTokenGuard } from './http/simulator-token.guard.ts';

@Module({
  imports: [RouteResolverModule, WorkModule],
  controllers: [CallSimulatorController],
  providers: [SimulatorTokenGuard],
})
export class CallSimulatorModule {}
