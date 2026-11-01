# Tabletop agenda — MFA reset and compromised account (P06.09.04)

Status: prepared for the founder, not yet run. Item P06.09.04 stays `WAITING_FOR_EXTERNAL`
(counterparty: founder; requested 2026-11-01; expected 2026-11-15, confirmed by the founder on
2026-11-01; fallback: the runbooks stay non-executable and the sessions' own walk-through of
2026-10-08, EV-P06-055, remains the only record). The founder only attends and answers; the
facilitator reads the scenarios and writes the record.

Documents under test: `docs/runbooks/mfa-reset.md` and `docs/runbooks/compromised-account.md`.
Both state that they are not executable until every _REQUIRED CONTROL_ exists and this tabletop is
recorded, so the purpose is to find where a person would be stuck or tempted to improvise, not to
rehearse a procedure that can already be run.

## Logistics

- **Length:** 45 minutes. **Who:** the founder (decider), a facilitator who reads and records.
- **Bring:** the two runbooks, `docs/security/access-matrix.md`, `docs/security/sessions.md`, and a
  blank copy of the record template at the end of this file.
- **Rule:** nobody opens a real account, console or customer record. Every scenario uses invented
  names and the reserved test ranges.

## Agenda

| Minutes | Block               | What happens                                                                                                            |
| ------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 0–5     | Frame               | Read the "What exists today and what does not" section of each runbook aloud. Agree what "stuck" means for this session |
| 5–20    | MFA reset           | Scenarios 1 to 3 below, against `mfa-reset.md`                                                                          |
| 20–35   | Compromised account | Scenarios 4 to 6 below, against `compromised-account.md`                                                                |
| 35–42   | Questions           | The six questions below, answered in one sentence each, or recorded as open                                             |
| 42–45   | Record              | Fill the record together; agree owners for each open point                                                              |

## Scenarios

**MFA reset**

1. **A caller claims to be the owner who lost their phone.** They know the business name and the
   owner's first name and ask for an MFA reset today. Who may act, what never counts as proof, and
   which step stops the procedure first?
2. **The registered business number does not answer.** The owner callback on the registered number
   goes to voicemail twice. What does the runbook say, and who decides to wait or abort?
3. **The second factor is a billing detail the caller gets wrong once.** One wrong answer, then the
   right one. Does the runbook allow a second attempt, and where is the attempt recorded?

**Compromised account**

4. **An admin account signs in from a new country at 03:00 and invites two addresses.** What is the
   first containment action, in what order are sessions, grants and invitations dealt with, and what
   is preserved before anything is changed?
5. **The compromised account is the only owner.** What does "The only owner" section require, who
   becomes the contact, and what must not be done (for example, deleting the account)?
6. **A support grant the account created is still live.** How is it found and revoked, and where is
   the revocation recorded?

## Questions to answer

1. At which step would a person without engineering help be unable to continue? Name the step.
2. Which _REQUIRED CONTROL_ would you want built first, and why that one?
3. Is the proof for an MFA reset strong enough for a business number that is a mobile phone?
4. Who decides to notify the data-protection authority and the customer, and in what time?
5. What is the maximum time a contained account may stay contained before someone must decide?
6. Is anything in either runbook something you would be uncomfortable seeing a support person do on
   their own?

## What gets recorded

One short record per scenario, in `docs/evidence/P06/` as a new evidence record, and one line in each
runbook's "Verification of this runbook" section (append only): date, attendees (roles), the
scenarios walked, the steps where the group was stuck or improvised, the questions answered, the open
points with an owner, and the verdict (runbook usable as written, usable after changes, or not
usable). Nothing from a real person or customer is written down.

### Record template

```text
Date:
Attendees (roles):
Scenario 1..6: walked / skipped; stuck at step; improvised? (yes/no, what)
Questions 1..6: answers or "open"
Open points (owner, date):
Verdict per runbook: usable as written | usable after changes | not usable
Recorded by:
```

When the record exists, the item can be ticked by a session that cites it; the founder's attendance
is the external act this item waits for.
