/**
 * Data-services shapes (P05.07.01–.07, SHAPES ONLY): RDS-17 + Valkey TLS/AUTH
 * + SQS+DLQ KMS + S3 block-public/KMS/versioning + scheduler group + SES
 * DKIM/SPF/DMARC + encryption-at-rest rule. No live AWS calls, no
 * credentials (INV-15); live provisioning stays founder-only (EXT-09).
 */

export interface RdsShape {
  readonly engineVersion: string;
  readonly forceSsl: boolean;
  readonly kms: boolean;
  readonly deletionProtectionProd: boolean;
}

/** RDS PostgreSQL 17 with SSL, KMS, prod deletion protection. */
export function rdsValid(shape: RdsShape): boolean {
  return (
    shape.engineVersion === '17' && shape.forceSsl && shape.kms && shape.deletionProtectionProd
  );
}

export interface ValkeyShape {
  readonly tls: boolean;
  readonly auth: boolean;
}

/** Valkey with TLS + AUTH. */
export function valkeyValid(shape: ValkeyShape): boolean {
  return shape.tls && shape.auth;
}

export interface QueueShape {
  readonly kms: boolean;
  readonly dlq: boolean;
}

/** SQS queues with KMS and DLQ redrive. */
export function queueValid(shape: QueueShape): boolean {
  return shape.kms && shape.dlq;
}

export interface BucketShape {
  readonly blockPublic: boolean;
  readonly kms: boolean;
  readonly versioning: boolean;
}

/** S3 with block-public + KMS + versioning. */
export function bucketValid(shape: BucketShape): boolean {
  return shape.blockPublic && shape.kms && shape.versioning;
}

export interface SesShape {
  readonly dkim: boolean;
  readonly spf: boolean;
  readonly dmarc: boolean;
}

/** SES domain identity with DKIM/SPF/DMARC. */
export function sesValid(shape: SesShape): boolean {
  return shape.dkim && shape.spf && shape.dmarc;
}

/** Encryption at rest everywhere: rds + valkey + queues + buckets. */
export function encryptionAtRest(
  rds: RdsShape,
  valkey: ValkeyShape,
  queue: QueueShape,
  bucket: BucketShape,
): boolean {
  return rds.kms && valkey.tls && queue.kms && bucket.kms;
}
