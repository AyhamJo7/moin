/**
 * Terraform foundation shapes (P05.03.01/.02, SHAPES ONLY): bootstrap
 * state-bucket shape, module registry, tagging standard. No live AWS calls,
 * no state writes, no credentials (INV-15); live applies stay founder-only
 * (EXT-09). The HCL under infrastructure/terraform rides separately.
 */

/** Module registry (P05.03.02): every module the compositions may use. */
export const TF_MODULES: readonly string[] = [
  'network',
  'edge',
  'ecs-service',
  'rds',
  'valkey',
  'sqs-queue',
  's3-bucket',
  'scheduler',
  'ses',
  'kms',
  'observability',
  'backup',
  'waf',
];

/** Bootstrap state-bucket shape (P05.03.01). */
export interface StateBucket {
  readonly versioning: boolean;
  readonly kms: boolean;
  readonly objectLock: boolean;
  readonly useLockfile: boolean;
}

/** True when the bootstrap bucket meets the shape. */
export function stateBucketValid(bucket: StateBucket): boolean {
  return bucket.versioning && bucket.kms && bucket.objectLock && bucket.useLockfile;
}

/** Tagging standard (P05.03.02): env, service, data_class, owner. */
export interface TagSet {
  readonly env: string;
  readonly service: string;
  readonly dataClass: string;
  readonly owner: string;
}

/** True when every required tag is present and non-empty. */
export function tagsValid(tags: TagSet): boolean {
  for (const value of [tags.env, tags.service, tags.dataClass, tags.owner]) {
    if (value.trim().length === 0) return false;
  }
  return true;
}

/** True when the module is in the registry. */
export function moduleRegistered(name: string): boolean {
  return TF_MODULES.includes(name);
}
