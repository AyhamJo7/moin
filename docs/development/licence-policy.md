# Dependency licence policy

Checked by `scripts/check-licences.ts` on every pull request (QG-11) and enforced by the
`security-scan` workflow.

## The rule

**Production dependencies only.** A copyleft build tool is irrelevant: it is never distributed and
never linked into anything shipped. A copyleft library inside the runtime image is a different
question, because this product is a hosted service whose source stays closed.

| Category                     | Examples                                                         | Allowed?                                                                                           |
| ---------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Permissive                   | MIT, ISC, Apache-2.0, BSD-2/3-Clause, 0BSD, Unlicense, Zlib, CC0 | Yes                                                                                                |
| Weak copyleft, file-level    | MPL-2.0                                                          | Yes — the obligation is to publish changes to the licensed files, which we can meet                |
| Weak copyleft, library-level | LGPL-2.1, LGPL-3.0                                               | Yes, for a hosted service — see below                                                              |
| Strong copyleft              | GPL-2.0, GPL-3.0                                                 | **No** — linking obliges us to publish our source                                                  |
| Network copyleft             | AGPL-1.0, AGPL-3.0                                               | **No** — the network clause reaches software offered over a network, which is exactly what this is |
| Source-available             | SSPL-1.0, BUSL-1.1, Elastic-2.0                                  | **No** — not open-source licences; their use or service clauses reach a hosted offering            |
| Non-commercial               | CC-BY-NC-*                                                       | **No**                                                                                             |
| Undetermined                 | missing, `UNKNOWN`, `UNLICENSED`, `SEE LICENSE IN …`             | **No**                                                                                             |

"Undetermined" fails rather than warns. A dependency whose licence cannot be determined is one
whose obligations cannot be met, and a warning is how it gets in.

## Why LGPL is allowed and AGPL is not

This is the distinction that does the work, so it is worth stating precisely.

**LGPL obligations attach on _distribution_ of the work.** Running software on our own servers and
exposing an HTTP API is not distribution: no user receives a copy of the binary. LGPL also carries
**no network clause** — the thing that was added to AGPL precisely because hosted services fall
outside the GPL's trigger.

**AGPL's §13 closes exactly that gap.** It reaches users who interact with the software _over a
network_, which is what every caller and every owner of this product does. An AGPL dependency in
the server would oblige us to offer our source to them.

So the rule is not "copyleft bad". It is: an obligation we can meet is acceptable, and an
obligation that would require publishing this product's source is not.

### The one case today

`@img/sharp-libvips-*` is **LGPL-3.0-or-later**, reached through `sharp`, reached through Next.js
image optimisation. It is allowed under the reading above.

**This is a legal interpretation, not a settled fact**, and it is listed for the external review
(EXT-02) rather than treated as decided. If that review disagrees, the remedy is small and known:
disable Next.js image optimisation, which is the only thing pulling libvips in.

## Adding a dependency

1. Run `pnpm install` and then `node scripts/check-licences.ts`.
2. If it fails, prefer a differently licensed alternative. Most refusals have one.
3. If there is genuinely no alternative, the exception is a founder decision recorded in an ADR
   with the licence text, the obligation, and how we meet it — never a quiet addition to the
   allowlist.

## Proving the check works

```bash
node scripts/check-licences.ts --fixture agpl      # exits 1
node scripts/check-licences.ts --fixture sspl      # exits 1
node scripts/check-licences.ts --fixture gpl       # exits 1
node scripts/check-licences.ts --fixture unknown   # exits 1
```

A licence check nobody has watched refuse anything is indistinguishable from one that allows
everything, which is why these fixtures exist and are asserted in `check-licences.test.ts`.
