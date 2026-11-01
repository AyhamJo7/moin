# ADR-0036 — Time, locale and calendars

- **Status:** Accepted (default adopted under founder delegation 2026-11-01; founder may override)
- **Deciders:** founder (delegated to the orchestrating session on 2026-11-01 for the open
  decisions; this ADR was drafted from the code on main `3510fea`, not from a plan)
- **Phase:** P07 (register row), implemented in P07.14 and P09.03
- **Related:** ADR-0003, ADR-0015, INV-18, A-21

## Context

KlarDesk answers calls for small German businesses. Time decides what the product says: whether
the business is open now, when it next opens, which day a callback "tomorrow" means, whether a
public holiday or the owner's Betriebsferien changes the answer. Three things make this easy to get
wrong and hard to notice: a calendar day is 23, 24 or 25 hours long twice a year; the same wall
clock time occurs twice (autumn) or not at all (spring); and holidays differ by Bundesland while
company holidays belong to one tenant.

This ADR records what the code on main already does and the decisions that follow from it. Where
the code does not do something yet, the decision is stated and the phase that implements it is
named. It does not describe behaviour that does not exist.

## Decision

1. **Storage is UTC.** Every instant is stored as `timestamptz`, which Postgres keeps in UTC.
   Business logic computes on UTC instants and only renders in the tenant zone. Adding a duration
   to an instant is exact, including across a daylight saving transition. The opening-hours rules
   are the one place wall-clock values are stored: weekly rules hold minutes since midnight
   (`opens_min`, `closes_min`, 0–1439) per weekday (0–6), and exceptions hold dates.

2. **The tenant time zone is Europe/Berlin, and only that.** `organisations.time_zone` and
   `locations.time_zone` exist and default to `Europe/Berlin` (migration 0005). The kernel
   (`packages/kernel/src/tenant-time.ts`) accepts only that zone: a malformed zone name and any
   well-formed zone other than Europe/Berlin both raise `RangeError`. No code reads the stored
   column to pick a different zone today. A second zone is a deliberate change with its own tests
   and an amendment of this ADR, because the gap and fold repair below hardcodes EU semantics.

3. **Daylight saving is handled by construction, not by patching.**
   - Rendering resolves the zone through `Intl`; a pinned table of the EU transitions for
     2024–2030 (`berlinOffsetMinutesAt`) serves as a tzdata-independent cross-check, and outside
     the table the `Intl` path applies.
   - `addCalendarDays` adds days to the zoned date and resolves back to the same local time of
     day, so an appointment stays at 09:00 local across a transition (the UTC duration is 23, 24
     or 25 hours).
   - A local time that does not exist (the spring gap) shifts forward to the first existing
     instant; a local time that exists twice (the autumn fold) resolves to the earlier occurrence.

4. **Opening hours are a deterministic engine, never a model.** `packages/db/src/hours.ts`
   (P09.03) holds weekly rules (`opening_rules`) and dated exceptions (`opening_exceptions`: kind
   `holiday`, `closure` or `vacation`, an inclusive date range, optional override hours, `NULL`
   hours meaning closed all day). Resolution order: an exception wins over the weekly rules; a
   public holiday without an explicit exception keeps the weekly rules, because a holiday override
   must be explicit and silence is never guessed; an interval that spans midnight is split across
   the two days; `nextOpening` scans forward day by day for at most 366 days. All time arithmetic
   goes through the kernel functions above. Writes use optimistic locking and the audit event
   carries markers only (INV-10, INV-12).

5. **Public holidays are a reviewed data file, Hamburg first.** `packages/kernel/src/holidays.ts`
   holds the ten Hamburg feasts for 2026–2030 (six fixed, four Easter movables). The next year is
   appended before December; a kernel test fails in November when the next year is missing, which
   is the reminder. Other Bundesländer arrive with their first customer, because their sets differ.
   A `public_holidays` table is reserved in the global-tables register for the day queries need
   SQL (A-21).

6. **Betriebsferien are tenant data.** A company holiday is an `opening_exceptions` row of kind
   `vacation` for a location. It is never written to the global holiday file.

7. **Owner-visible and spoken dates are formatted by one module.** `packages/kernel/src/format-de.ts`
   renders German dates and times (for example "Samstag, 3. Oktober" and "19:30 Uhr"). `Intl`
   supplies the zoned numeric fields (day, month, weekday index, hour, minute, through
   `zonedFields` in `tenant-time.ts`) and the German number format; the German date words come
   from two fixed arrays in the module, `WEEKDAYS_DE` and `MONTHS_DE`. The module's header
   comment says it never uses hand-rolled month tables; that comment is out of date and is not
   what the code does. Moving the date words to `Intl` `de-DE` is a possible later change, not
   an existing fact. The locale is German; no other locale is implemented.

### Not implemented yet, and where it lands

| Decision                                                           | State on main                                                                                               | Phase                                                                           |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Voice and owner-app answers that use `isOpenAt` and `nextOpening`  | The engine and its tests exist; no HTTP, voice or job path calls it                                         | the phases that wire opening hours into answers (P12 turn flows, P13 owner app) |
| Per-location Betriebsferien entry in the owner app                 | The table and the write functions exist; no owner-facing screen                                             | P13                                                                             |
| Yearly holiday refresh                                             | A static file plus the November staleness test; no refresh job (approved deferral recorded under P07.14.02) | P09.03 owns it per the deferral                                                 |
| A zone other than Europe/Berlin, other Bundesländer, other locales | Rejected or absent by design                                                                                | each arrives with its first customer and an amendment of this ADR               |

## Alternatives considered

| Option                                                            | Why not                                                                                                                                                         |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store local wall-clock timestamps and convert on read             | The same local time occurs twice in autumn and not at all in spring; stored local values are ambiguous or invalid, and every comparison needs the zone          |
| Add 24 hours times n to an instant to move n days                 | Drifts by an hour across a transition; an appointment moves from 09:00 to 08:00 or 10:00                                                                        |
| Generic multi-zone support from the start                         | The gap and fold repair hardcodes EU semantics (60-minute gap and fold); other zones would misresolve silently. Unowned scope for a German pilot                |
| Per-tenant holiday tables in the database now                     | Lookups are by (Bundesland, date), a map access; a reviewed file is the smaller honest shape until queries need SQL (then the reserved `public_holidays` table) |
| Treat a public holiday as closed unless the tenant says otherwise | A guess about a business's opening hours spoken to a caller; the engine keeps the weekly rules until the tenant records an exception                            |
| Let the AI model answer "are you open now"                        | Opening hours are a deterministic fact (PLAN determinism table); a model adds error and cost with no benefit                                                    |

## Consequences

- Correct DST behaviour is the default for any code that goes through the kernel; code that adds
  days to wall-clock fields breaks it, so such code must not exist outside the kernel.
- The Berlin-only gate means a second zone or Bundesland is real work, not configuration.
- The holiday file needs a yearly edit before December and fails the kernel tests in November if
  that is forgotten. Until the refresh job exists a person does it.
- The hours engine is correct but not yet reachable from a caller; this ADR does not claim it is
  live. That is the largest gap between the decision and the product.
- This would be the wrong call if a customer outside Germany, or in a state with different feasts,
  arrives before the amendments above are made.

## Verification

| Enforcement                                                                                                                                                                                              | Where                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Berlin-only gate, DST transition offsets, calendar-day add across both transitions, gap and fold policy, one spelling of owner-visible dates, the ten Hamburg feasts and the November staleness reminder | `packages/kernel/src/time-locale.test.ts`                              |
| Opening-hours resolution (exceptions win, holiday without exception keeps weekly rules, midnight split, next opening, week description) and its tenant isolation                                         | `packages/db/src/hours.integration.test.ts` and the kernel tests above |
| Storage column types and the default zone                                                                                                                                                                | migrations 0005 and 0054                                               |
