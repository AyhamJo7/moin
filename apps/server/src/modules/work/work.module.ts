/**
 * Work (P07.06 tasks, P13.02 Today): the owner-facing task read, M1 vertical slice.
 *
 * api only. The guards come from the identity module, whose exports supply the request-context
 * service they need; the tenant pool comes from the platform.
 */

import { Module } from '@nestjs/common';
import { IdentityAccessModule } from '../identity-access/identity-access.module.ts';
import { TenantPoolModule } from '../platform/tenant-pool.module.ts';
import { WorkQueries } from '../platform/work-queries.ts';
import { TodayController } from './http/today.controller.ts';

@Module({
  imports: [IdentityAccessModule, TenantPoolModule],
  controllers: [TodayController],
  providers: [WorkQueries],
  exports: [WorkQueries],
})
export class WorkModule {}
