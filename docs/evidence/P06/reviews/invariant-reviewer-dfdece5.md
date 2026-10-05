# invariant-reviewer — QG-09 review at dfdece5 (MWAIT2 NOWAIT probe & row lock repair)

| Field | Value |
|---|---|
| Reviewer role | invariant-reviewer |
| Implementation SHA | `dfdece53e11fd6095daa9c44bab8dae3363d0b91` (full 40-char; branch `feat/p06-06-membership-recheck`, base `1b944763d5569c1712787c89e388e81e79ea9cbb`) |
| Scope reviewed | Delta `6e81c1e..dfdece5`: MWAIT2 NOWAIT proof; invariant path matrix (INV-01, INV-02, INV-12, INV-15); four-lock hierarchy; companion policy scoping. |
| Verdict | OK TO MERGE — NO BYPASS FOUND |

## Findings

- Full invariant matrix verified PASS across all entry points and primitives.
- MWAIT2 NOWAIT probe is test-only, runs in dedicated client with `rollback`, reads no membership content beyond lock contention, sets no marker, and touches no production code.
- Companion policy `memberships_request_lookup_lock` restricts writes via tenant `WITH CHECK`.
- Lock hierarchy (family -> session -> user -> memberships) strictly preserved.

## Dispositions

- Nothing blocks on invariant grounds.
