/**
 * Delivery-pipeline shapes (P05.09.01–.04, SHAPES ONLY): build-once-digest +
 * SBOM + attestation + staging/prod deploy-flow + release-manifest + rollback
 * shapes. No live deploys; live pipelines stay founder-driven.
 */

export interface BuildShape {
  readonly byDigest: boolean;
  readonly sbom: boolean;
  readonly attestation: boolean;
}

/** Build once per commit: digest + SBOM + provenance attestation. */
export function buildValid(shape: BuildShape): boolean {
  return shape.byDigest && shape.sbom && shape.attestation;
}

export type DeployStage = 'migrate' | 'deploy' | 'smoke' | 'watch';

/** Staging flow: migrate → deploy → smoke (P05.09.02). */
export function stagingFlow(): readonly DeployStage[] {
  return ['migrate', 'deploy', 'smoke'];
}

/** Production flow: migrate → deploy → smoke → 30-min watch (P05.09.03). */
export function prodFlow(): readonly DeployStage[] {
  return ['migrate', 'deploy', 'smoke', 'watch'];
}

export interface ReleaseManifest {
  readonly digest: string;
  readonly migrations: boolean;
  readonly versionsPinned: boolean;
  readonly evalReports: boolean;
}

/** Release manifest: digest + migrations + versions + eval reports. */
export function manifestValid(manifest: ReleaseManifest): boolean {
  if (manifest.digest.trim().length === 0) return false;
  return manifest.migrations && manifest.versionsPinned && manifest.evalReports;
}

export interface Rollback {
  readonly previousDigest: string;
  readonly automaticOnAlarm: boolean;
}

/** Rollback: previous digest known, automatic on alarm. */
export function rollbackValid(rollback: Rollback): boolean {
  return rollback.previousDigest.trim().length > 0 && rollback.automaticOnAlarm;
}
