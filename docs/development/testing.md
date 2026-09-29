# Testing

## The suites

| Suite         | What it covers                                        | Needs           | Runs                                 |
| ------------- | ----------------------------------------------------- | --------------- | ------------------------------------ |
| `unit`        | Domain rules, validators, state machines, normalisers | nothing         | every PR                             |
| `integration` | Repositories, RLS, migrations, queues, storage        | the local stack | every PR                             |
| `e2e`         | Owner journeys, accessibility                         | a built web app | Chromium per PR, full matrix nightly |

```bash
pnpm test                # unit
pnpm test:integration    # needs `pnpm dev:up` and the environment file copied
pnpm test:e2e            # needs `pnpm --filter @moin/web build`, and once:
                         #   pnpm exec playwright install chromium
```

`pnpm test:integration` reads the environment file for `TEST_DATABASE_ADMIN_URL` and
`TEST_DATABASE_APP_URL`; both are in the example. The app connection must be the **application**
role — an admin connection bypasses row-level security, so a suite run against one would pass while
proving nothing. The harness refuses to fall back to it rather than doing so silently.

## Two rules that are not negotiable

### Real PostgreSQL for anything touching the database

Embedded and in-memory Postgres run as **superuser**, which silently bypasses row-level security.
A cross-tenant test against one would pass while the policy it claims to verify does not exist —
the most dangerous kind of green.

The harness asserts its own connecting role is neither superuser nor `BYPASSRLS`, so this cannot
drift quietly.

### Every data-touching test must pass standalone

Not just inside the suite. Tests that share a database are ordered by accident: one file's leftover
rows become another's fixture, and the suite passes while each file fails alone.

This is structural rather than a discipline: **each integration file gets its own database**, cloned
from a migrated template with `CREATE DATABASE … TEMPLATE …`. Writing a test the normal way already
satisfies it.

```ts
const database = await createTestDatabase('my-feature');
// ... use database.pool()
await database.drop();
```

## Test data

Synthetic only (INV-16), from `@moin/testing`:

```ts
import { Seeded, germanPerson } from '@moin/testing';

const person = germanPerson(new Seeded(42)); // reproducible from the seed
```

Realistic on purpose — umlauts and ß break naive slugs and sorting, PLZ can start with a zero, and
German area codes are variable-length. Every generated phone number is inside a Bundesnetzagentur
**test range** and every email domain is `.example` (RFC 2606), so a fixture that escapes into a
real dialler or mailer cannot reach a person.

Seeded rather than random, so a failing case is reproducible from its seed instead of appearing
once in fifty runs and never again.

## Time

Never `Date.now()` in code under test. Take a `Clock`:

```ts
import { fixedClock } from '@moin/kernel';

const clock = fixedClock(new Date('2026-12-24T17:30:00Z'));
clock.advance(90 * 60 * 1000);
```

Opening hours, reminder windows, slot holds, token expiry and retention all branch on "now". With
a real clock none of that is testable without sleeping, and tests that sleep become the flaky ones
that get quarantined.

## Failure paths

Every external integration has to handle timeouts, 429s, 5xx, malformed responses, duplicate and
out-of-order events, expired credentials, partial success and unknown state. Those paths never run
in a happy-path test, so trigger them:

```ts
import { withFault, neverSettles } from '@moin/testing';

const flaky = withFault(callProvider, { kind: 'rate-limited', failTimes: 2 });
```

`failTimes` models the realistic case — a provider that fails twice and then succeeds. A helper
that always fails only proves the error branch exists; it never shows whether the retry path
recovers, or whether recovering a second time duplicates a side effect.

`neverSettles()` proves a caller applies its own deadline. Code that awaits a provider without one
does not hang loudly: it holds a connection, a queue slot or a call open until something else gives
up.

**A timeout is never success.** An unknown outcome is reconciled, not assumed (INV-05, INV-11).

## Fixing a bug

A fix counts only with a regression test **proven to catch the bug**:

```bash
python3 .claude/bin/mutation_check.py --test "pnpm exec vitest run path/to/the.test.ts"
```

It must report `KILLED`: the test fails without the fix and passes with it. A test written after
the fix, never seen to fail, often asserts the new behaviour rather than the absence of the bug.

Never revert a fix with `git checkout` or `git restore` to "check" — mutation-check does it safely.

## Accessibility

`@axe-core/playwright` runs on changed routes every PR. Automated checks catch roughly a third of
real accessibility problems, so zero violations is a **floor, not a certificate**; the manual
keyboard and screen-reader pass per release covers the rest.

The browser context is `de-DE` / `Europe/Berlin`, because a browser negotiating `en-US` hides
every localisation bug.

## Flaky tests

Fixed or deleted within five working days. Quarantine needs an issue and **never** applies to
isolation, idempotency or gate tests — those are the ones whose flakiness would hide a real defect.

## Coverage

`packages/kernel`, the policy engine, the dialogue manager and the tool guard: **≥ 90 % branch
coverage**. Everything else is guided by risk, not a global percentage. A repository-wide number
mostly measures how much trivial code has been written.
