# EV-P06-040: Founder acceptance of P06.09.03 recovery runbooks at reviewed HEAD 15433fb

| Field | Value |
| --- | --- |
| Evidence ID | EV-P06-040 |
| Item | P06.09.03 |
| Date (UTC) | 2026-10-02 13:30 UTC |
| Commit | `15433fb200d6475fe6f871254d0daf001ec77e5f` |
| Environment | local |
| Command / procedure | Independent security and operational re-review of PR #34 against base `c85934acf9e329f8dc9d6fec9b3aecf3f78778da`; reviewed the runbooks and remediation deltas at the commit above. The verdict was `READY_FOR_FOUNDER_P06_09_03`. Founder accepted P06.09.03. No recovery procedure or tabletop was executed. |
| Result | PASS — founder acceptance of runbook documentation only |
| CI run / artifact | PR #34: 16/16 checks green at `15433fb`; the governance commit is verified separately |
| Reviewer | founder; independent verdict `READY_FOR_FOUNDER_P06_09_03` |

Sensitive material is stored by reference only (PLAN.md evidence rules).

A governance record. It changes no runbook, implementation, test, workflow or dependency file. The
commit above is the **reviewed substantive runbook HEAD**; the governance commit that carries this
record follows it and touches documentation only.

## The verdict

- Independent verdict: **`READY_FOR_FOUNDER_P06_09_03`**
- Reviewed substantive HEAD: `15433fb200d6475fe6f871254d0daf001ec77e5f`
- Base: `c85934acf9e329f8dc9d6fec9b3aecf3f78778da`
- Runbook evidence: EV-P06-039
- Founder decision: P06.09.03 accepted, with the decisions below.

## Founder decisions

| # | Decision | Founder ruling |
| --- | --- | --- |
| 1 | Compromised-account containment | Both existing KlarDesk application sessions revoked **and** fresh KlarDesk application access denied; verify an old session fails and a fresh sign-in yields no usable access. Provider-side sign-out or token revocation is supplementary and does not prevent reauthentication. Password change alone is not containment. If either guarantee cannot be enforced or verified, the account is not contained, the incident remains open and the procedure stops and escalates. |
| 2 | MFA re-enrolment | Keep ordinary application access denied through authorised recovery, old-session revocation, replacement-factor enrolment, successful verification/use of the new MFA factor, recovery finalisation and mandatory audit. Only then restore ordinary access deliberately. Provider authentication for enrolment may occur in a recovery-only flow but must yield no ordinary session or business access before completion. |
| 3 | Recovery proof | Registered business-number callback and billing or invoice facts are contextual fraud checks only. Email possession, caller voice, IdP roles or groups, and claimant-supplied contact details are not recovery authority. A future approved high-assurance mechanism must provide independent proof; no founder, operator, manager or urgency override substitutes for it. |
| 4 | Only owner | No weaker proof, temporary no-MFA access, founder override or manual ownership workaround. Ordinary access can remain unavailable until safe recovery completes. |
| 5 | Operator account | Revoke existing privileged access, deny fresh privileged application access and verify both. Operator recovery stays separate from customer recovery and depends on P06.11. |

## Resulting status

P06.09.03 verifies the **documents**. Fresh-login denial, recovery-only sessions, a hold mechanism,
MFA-reset orchestration, replacement-factor gating, session revocation, provider recovery commands
and production audit-writer adoption remain future implementation. No Cognito recovery operation,
session revocation or tabletop was performed or verified by this acceptance.

| Item | Status |
| --- | --- |
| P06.09.01 | **OPEN** — password reset through Cognito |
| P06.09.02 | **OPEN** — approved proof and recovery/containment mechanisms |
| P06.09.03 | **VERIFIED** — founder-authorized on `READY_FOR_FOUNDER_P06_09_03`; EV-P06-039 and this record |
| P06.09.04 | **OPEN** — tabletop not performed |
| P06.09 | **IN_PROGRESS**, incomplete |
| P06 | **IN_PROGRESS**, incomplete |

PR #34 remains draft. The historical `74bc27f66028eb1c205fabdd09b93df803f60c85` source on
`feat/p06-05-oidc` and its `moin-auth` worktree remain untouched until a separate post-merge action.
