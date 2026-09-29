# Evidence registry

Every `EV-Pxx-nnn` record produced for PLAN.md lives in `docs/evidence/<phase>/` and is
registered here. Records are created with:

```bash
python3 .claude/bin/evidence.py new --phase P02 --item P02.05.06 --slug standalone-tests \
    --summary "…" --from-gates full
```

and audited with `python3 .claude/bin/evidence.py check`.

**Sensitive evidence is never committed.** Pentest reports, legal opinions, signed contracts and
anything containing personal data are stored outside the repository; the record holds only the
storage location, a SHA-256 hash, the date and the counterparty (PLAN.md, *Evidence rules*).
Screenshots containing personal data are forbidden — use the demo tenant.

## ID allocation

`evidence.py` allocates IDs sequentially per phase (`max + 1`), in the order records are
genuinely earned. PLAN.md's per-phase *Required evidence* line names the artefacts it expects
but cannot bind them to a number before the work happens, so the mapping from a PLAN label to
the allocated ID is recorded in the phase's `Required-evidence mapping` section below rather
than assumed.

### P02 — required-evidence mapping (PLAN.md L2172)

| PLAN label | Allocated ID | State |
|---|---|---|
| CI run URLs | — | not yet earned |
| Negative-control PR links | — | not yet earned |
| Timed setup log | — | not yet earned |
| Ruleset export | — | not yet earned (EXT-24) |

## Records

| ID | Item | Date | Commit | Summary | Record |
|---|---|---|---|---|---|
