# Mutation evidence for the DG-10 prototype fixes

Both fixes on this branch were proven with the repository's official mutation check. For each one, the tool:

1. reverts exactly the fix commit's files;
2. runs the regression test, which must **fail**;
3. restores the fix and runs the test again, which must **pass**;
4. confirms the restoration is byte-identical and that the test changed no tracked file.

- **The patch files in `mutation/`** are byte copies of the reversal patches the tool wrote. Their SHA-256 is listed below.
- **The full JSON records** stay in the local evidence store at the paths shown. They aren't committed: they hold absolute local paths, and prettier would rewrite them.

## 1. Overlapping completions (independent review finding F1)

| Field                                          | Value                                                                                                                                                                      |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fix commit                                     | `ca5d818d3bb4c77a3868750e323085598f99d052` (`fix(p13): keep each prototype task's pending state across re-renders`)                                                        |
| Test, committed first and RED on its own       | `3787c62` (`test(p13): reproduce lost pending state across overlapping completions`)                                                                                       |
| Invocation                                     | `python3 .claude/bin/mutation_check.py --test "node docs/design/owner-test/check-concurrency.mjs" --fix-paths docs/design/owner-test/prototype/prototype.js --timeout 600` |
| Run                                            | 2026-10-20 16:30:18 to 16:30:22 UTC                                                                                                                                        |
| Without the fix                                | exit 1, 9 of 36 checks failing (below), no timeout                                                                                                                         |
| With the fix                                   | exit 0, 36 of 36                                                                                                                                                           |
| Restored byte-identical; tree changed by tests | yes; no                                                                                                                                                                    |
| Verdict                                        | **KILLED**                                                                                                                                                                 |
| Reversal patch                                 | [mutation/20261020T163018Z-concurrency.patch](mutation/20261020T163018Z-concurrency.patch), SHA-256 `fa4d36433f157e68c2f8f78abd9cfe718c5c0e95fa1ac6ff01959205cc28e071`     |
| JSON record (local)                            | `.git/claude-evidence/mutation/20261020T163018Z.json`, SHA-256 `30b2c6ce7e287b89f08ff4f98bc90884da44e7f7d3215c1b47877af06f4d1e81`                                          |

Failing assertions without the fix. These are business behaviour, not setup:

```
FAIL C: t102 is still pending after the re-render
FAIL E: one entry per task, got ["t101","t102","t102"]
FAIL F: two announcements, got 3
FAIL H: t102 pending after t104
FAIL H: t103 pending after t104
FAIL H: t103 pending after t102
FAIL J: a stale callback wrote ["t102"] into the reset session
FAIL J: a stale callback announced 1 completion(s)
FAIL M: focus stays on t103's control while t102 completes, got {"task":null,"id":"meldung"}
36 concurrency checks, 9 failure(s)
```

## 2. Pending label over the caller number at 320/360 px (earlier P3 finding)

This is preserved unchanged from the previous round.

| Field                                          | Value                                                                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fix commit                                     | `83cbe12f5e9b2cf14a0e3c4b6c8d1ce6806a2dc6`                                                                                                                                                                          |
| Invocation                                     | `python3 .claude/bin/mutation_check.py --test "node docs/design/review/render-mockups.mjs --check" --fix-paths docs/design/review/mockups/proposal.css docs/design/review/mockups/heute-actions.html --timeout 600` |
| Run                                            | 2026-10-20 15:15:25 to 15:15:42 UTC                                                                                                                                                                                 |
| Without / with the fix                         | exit 1 / exit 0                                                                                                                                                                                                     |
| Restored byte-identical; tree changed by tests | yes; no                                                                                                                                                                                                             |
| Verdict                                        | **KILLED**                                                                                                                                                                                                          |
| Reversal patch                                 | [mutation/20261020T151525Z-narrow-overlap.patch](mutation/20261020T151525Z-narrow-overlap.patch), SHA-256 `6685ad776ac7c24f800c898b056c98f9d8ee7f3b97f1c9db5910529f1b250cae`                                        |
| JSON record (local)                            | `.git/claude-evidence/mutation/20261020T151525Z.json`, SHA-256 `40663a6fbabba679bf52df925eac0d999928207ae718100fa388a32ccd5fed2e`                                                                                   |

Failing assertions without the fix (excerpt):

```
heute-actions-360: "cell-phone" overlaps "cell-action" in "Rückruf: Reservierung"
heute-actions-360: targets closer than 8 px: "+493000000102"
heute-actions-320: "cell-phone" overlaps "cell-action" in "Rückruf: Reservierung"
heute-actions-320: visible label "Wird gespeichert …" is not in the name "Erledigt: Rückruf: Reservierung"
```

## 3. Network and authorisation boundary (independent review finding F2)

F2 is a documentation fix. The negative control reverts the documents and pages to their previous wording and runs the boundary check against them.

| Field                                          | Value                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fix commit                                     | `29a00472b0` (`fix(p13): state the owner-test prototype's network boundary truthfully`)                                                                                                                                                                                                                                                                                                                                        |
| Invocation                                     | `python3 .claude/bin/mutation_check.py --test "node docs/design/owner-test/check-boundary.mjs" --fix-paths docs/decisions/DG-10-owner-app-visual-language.md docs/design/owner-usability-test.md docs/design/owner-test/README.md docs/design/owner-test/session-kit.md docs/design/owner-test/observation-sheet.md docs/design/owner-test/prototype/index.html docs/design/owner-test/prototype/moderator.html --timeout 300` |
| Run                                            | 2026-10-20 16:33:29 UTC                                                                                                                                                                                                                                                                                                                                                                                                        |
| Without / with the fix                         | exit 1 (21 of 123 failing) / exit 0                                                                                                                                                                                                                                                                                                                                                                                            |
| Restored byte-identical; tree changed by tests | yes; no                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Verdict                                        | **KILLED**                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Reversal patch                                 | [mutation/20261020T163329Z-network-boundary.patch](mutation/20261020T163329Z-network-boundary.patch), SHA-256 `cd1ec57b37f60f46f81f5b4ccc17dedec5ebef365e79c2bdc389d43e7514adf2`                                                                                                                                                                                                                                               |
| JSON record (local)                            | `.git/claude-evidence/mutation/20261020T163329Z.json`, SHA-256 `7a97a3d294ed85440ccb2494399ddf89e2b3e9d0284c8a91def3eed9cb5cb147`                                                                                                                                                                                                                                                                                              |

Failing assertions without the fix (excerpt):

```
FAIL readme: contains "0.0.0.0"
FAIL readme: contains "http.server"
FAIL record: the phone-access proposal is headed NOT AUTHORIZED
FAIL record: CSP described precisely (connect-src does not cover loading its own files)
FAIL index: claims "nichts an einen Server gesendet"
FAIL kit: claims "sendet nichts"
FAIL kit: consent covers possible address logging
123 boundary checks, 21 failure(s)
```

The boundary check reads files only. It starts no server, and **no network test was run**.
