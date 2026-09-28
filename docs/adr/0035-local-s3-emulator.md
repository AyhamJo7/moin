# ADR-0035 — Local S3 emulator: Adobe S3Mock

- **Status:** Accepted (P02.04.01, 2026-09-28) · **Deciders:** founder
- **Scope:** local development and automated tests only
- **Related:** ADR-0002, INV-16, QG-11

## Context

PLAN.md requires an S3-compatible emulator for the local stack and notes only that MinIO's OSS
distribution is archived, leaving the choice open. The decision matters beyond convenience: the
emulator is a dependency of every developer machine and every CI run, so its licence is a
production-adjacent commitment even though it never ships.

## Decision

**Adobe S3Mock**, pinned by digest, for local development and automated test infrastructure only.

```text
adobe/s3mock@sha256:c1beb36492706566afdea274fa19a15fe6ca519aa4d82889b13a127237b6d301   (4.9.0)
```

Production and staging use **real AWS S3**. Nothing about S3Mock reaches the domain or application
layer: storage is used through the port in `packages/integrations`, with the AWS SDK behind it, and
only the endpoint, path-style flag and credentials differ between environments.

### Why not the alternatives

| Option         | Why not                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MinIO**      | The OSS distribution is archived, and its licence history (AGPL-3.0) conflicts with the licence policy in P02.08.02 for anything we would depend on long term. |
| **LocalStack** | Broad AWS emulation, but commercial use of the wider product carries licensing conditions we would have to keep re-checking. We need S3, not an AWS simulator. |
| **Garage**     | AGPL-3.0, which the licence allowlist rejects.                                                                                                                 |
| **SeaweedFS**  | A complete distributed object store. Running one to emulate S3 is a large operational surface for a local dependency.                                          |

Apache-2.0, focused on S3 semantics, designed for container and Testcontainers-style use.

### Operations moin actually needs

`CreateBucket`/`ListBuckets`, `PutObject`, `GetObject`, `HeadObject`, `DeleteObject`,
`ListObjectsV2`, `CopyObject`, multipart upload, and presigned URLs for direct browser upload and
download.

### Known differences from real AWS S3

Recorded so nobody discovers them in staging:

- **No IAM.** S3Mock accepts any credentials, so bucket policies, ACLs and least-privilege roles
  are unverifiable locally — those are proven in staging against real S3 (P05, P17).
- **No object lock or WORM retention**, so compliance retention cannot be exercised locally.
- **No versioning, lifecycle rules, replication or storage classes.**
- **No server-side encryption semantics**, including KMS.
- **Eventual-consistency and rate-limiting behaviour differ**, so retry and backoff paths need the
  fault-injection adapters rather than the emulator to be exercised.
- **Presigned-URL signature validation is not equivalent** to SigV4 against real S3.

Anything on that list is verified against real S3 in staging and is **not** claimed from local
evidence (PLAN's no-fake-completion rule).

### Keeping emulator behaviour out of the code

- Storage is reached only through the port in `packages/integrations`; no module imports an S3
  client directly (enforced by `provider-sdks-stay-in-adapters` in `.dependency-cruiser.cjs`).
- The adapter is the AWS SDK in every environment. The emulator changes configuration, never code:
  `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE`.
- There is no `if (isLocal)` branch in the adapter — that would be a tenant-specific code path's
  close cousin and is exactly what INV-18 exists to prevent the habit of.
- The contract suite in P05 runs the same storage tests against staging's real S3, so a behaviour
  that only works on the emulator fails there rather than in production.

## Consequences

- Local and CI storage tests are fast, offline and free.
- IAM, encryption, versioning and object-lock behaviour are **not** covered locally and carry an
  explicit staging gate.
- `retainFilesOnExit` is off, so a run starts from an empty bucket: a missing `CreateBucket` in the
  application fails locally instead of surviving until staging.
