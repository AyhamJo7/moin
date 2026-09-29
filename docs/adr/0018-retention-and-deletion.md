# ADR-0018 — Retention and deletion

- **Status:** PROPOSED (drafted P03.01.03, 2026-09-29; accepted in P16) · **Deciders:** founder
- **Phase:** P03 → P16 · **Related:** ADR-0019, ADR-0038, INV-07, INV-12, INV-16, QG-12

## Context

The GDPR requires personal data to be kept no longer than necessary, and erased on request. Neither
is a policy document: both are code that has to find every copy, including the copies in backups,
in a search index, and in an object store.

The reliable way to get this wrong is to implement deletion per feature, which guarantees that the
feature added next year is missed.

## Decision (draft)

**Retention is a property of a data category, not of a table.** Each category carries a period, a
legal basis and a deletion method. The inventory (P03.06) is the register, and adding a
personal-data field without classifying it fails the privacy gate (QG-12).

**A retention engine sweeps on a schedule**, applying each category's policy. Deletion is a job,
never a migration: it must be resumable, rate-limited so it cannot take the database down, and
auditable.

**Every module implements an `ErasureHandler`** with a compile-time registry. A module cannot be
added without declaring how it erases or anonymises a contact and a tenant. This is the mechanism
that makes "we found every copy" checkable rather than hopeful: the registry is complete by
construction, and a missing implementation is a build failure.

**Three methods, chosen per category:**

- **Hard delete** — the row goes. Default for content.
- **Anonymise** — identifying fields are cleared and the record remains. Used where the shape of
  history must survive for billing or capacity reasons.
- **Crypto-erase** — destroy the key. Reserved for data that cannot practically be rewritten,
  notably in backups.

**Tenant deletion is a lifecycle, not a `DELETE`**: `terminating → purging → deleted`, with a grace
period during which it can be reversed, then irreversible purge, then a deletion certificate.
Accidental termination of a live business must be recoverable; deletion after the grace period must
not be.

**Backups are the hard part, and the answer is stated rather than avoided.** Backups are immutable
by design (ADR-0038), so an erasure request cannot reach into them. The position: backups have a
bounded retention window; erasure is applied to live data immediately and to backups by expiry; the
deletion ledger records the request and the date the last backup containing it expires. This is the
usual defensible reading, and it is **exactly the kind of question EXT-02 must confirm** rather than
something this session settles.

**The deletion ledger lives outside the database it records deletions from.** A record of "we
deleted this" that is itself deleted proves nothing.

## Alternatives considered

| Option                           | Why not                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Per-feature deletion code**    | Guarantees the next feature is missed. The registry makes completeness structural.                                                                         |
| **Soft delete everywhere**       | A flag is not erasure. The data is still there, still in backups, still readable by anything that forgets the filter.                                      |
| **Deletion as a migration**      | Not resumable, not rate-limited, and it holds locks for the length of a table scan.                                                                        |
| **Rewriting backups on erasure** | Breaks their immutability and their integrity guarantees, which is the property that makes them a recovery mechanism.                                      |
| **Crypto-erase for everything**  | Elegant, and it makes every read a decrypt and every key rotation a re-encrypt of the whole estate. Reserved for where rewriting is genuinely impractical. |

## Consequences

- Every new personal-data field must be classified before it ships (QG-12).
- Every module carries erasure code, and its absence is a build failure rather than an audit finding.
- Erasure is eventually complete, not instantaneous, with the backup window as the bound. That must
  be stated in the privacy policy honestly.
- The retention engine is a permanent scheduled job whose failure is alarmed: silently stopping
  means silently over-retaining.

## Open before acceptance (P16)

- Per-category periods, which depend on EXT-02 and on the tax-retention questions for billing data.
- Whether the backup-expiry reading above is accepted by counsel.
- Whether any category needs crypto-erase in live data, not only in backups.

## Verification

| Enforcement                                                                  | Where                                                                 |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Every module declares an erasure handler                                     | Compile-time registry plus a test asserting completeness (P16.03)     |
| No unclassified personal-data column                                         | Data-dictionary check against the inventory (P03.06.04, then QG-12)   |
| Erasure actually removes the data                                            | Per-module test: create, erase, assert no readable trace in live data |
| Tenant deletion is reversible before the grace period and irreversible after | Lifecycle state-machine tests                                         |
| The retention engine stopping is noticed                                     | Alarm on sweep age (P15)                                              |
| The deletion ledger survives the deletion                                    | Stored outside the primary database (P16.05)                          |
