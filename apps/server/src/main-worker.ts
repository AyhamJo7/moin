import 'reflect-metadata';
import { bootstrapHttpRole } from './bootstrap.ts';
import { WorkerRootModule } from './roots/worker-root.module.ts';

await bootstrapHttpRole({ rootModule: WorkerRootModule, role: 'worker' });
