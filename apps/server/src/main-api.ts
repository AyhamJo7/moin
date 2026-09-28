import 'reflect-metadata';
import { bootstrapHttpRole } from './bootstrap.ts';
import { ApiRootModule } from './roots/api-root.module.ts';

await bootstrapHttpRole({ rootModule: ApiRootModule, role: 'api' });
