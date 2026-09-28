# ADR-0034 — Naming and brand decoupling

- **Status:** Accepted (P02.02.09, 2026-09-28)
- **Deciders:** founder
- **Related:** INV-18, ADR-0002

## Context

The repository codename is `moin`. The product sold to customers is **KlarDesk** ("Digitales Front
Office für kleine Betriebe"). Those two names are not guaranteed to stay attached to each other: a
brand can change after a trademark search, a partner can resell under their own name, and a second
vertical can want its own identity. Meanwhile a caller hears a greeting, an email arrives from a
sender address, and a push notification shows an app name — all of which are brand surfaces.

If the brand is compiled in, a rename becomes a migration across templates, email footers, voice
prompts, push payloads and legal text, and each missed occurrence is a customer-visible defect.

## Decision

`moin` is an **internal codename only**. It appears in the repository name, package scope
(`@moin/*`), module names, container images, Terraform resource names and log fields.

Every customer-visible identity string is **configuration**, resolved at runtime:

| Surface                                  | Source                                       |
| ---------------------------------------- | -------------------------------------------- |
| Product name in UI and emails            | tenant/brand configuration                   |
| Voice greeting and AI disclosure wording | knowledge and template data (INV-03, INV-08) |
| Email sender identity and footer         | integration configuration, per tenant        |
| Web domain and links                     | environment configuration                    |
| Push notification title                  | brand configuration                          |
| Legal entity, imprint, privacy contact   | privacy configuration (P16)                  |

Rules that follow from this:

- No customer-visible brand string is a literal in application code, in a prompt, or in a migration.
- The brand configuration is **not** a tenant conditional. It is data that every tenant reads the
  same way, which is what keeps this compatible with INV-18 rather than a loophole in it.
- `moin` never appears in a customer-visible surface. A leaked codename in a greeting or an email
  footer is a defect, not cosmetic.

## Consequences

- Renaming the product is a configuration change plus a template review, not a code migration.
- Reselling under a partner brand, and running a second vertical under its own name, are already
  possible — no new mechanism is needed.
- There is one indirection to pay for on every brand surface, and a lint-visible rule to hold:
  a literal product name in code is a review finding.
- P02.03.03's configuration loader is where the brand configuration is validated, so a missing or
  malformed brand string fails at startup rather than in a caller's ear.

## Alternatives considered

- **Use the product name everywhere, rename later if needed.** This is the cost this ADR exists to
  avoid: the rename lands after there are live tenants, recorded greetings and sent emails, which
  is the worst moment to do a repository-wide string migration.
- **Two builds, one per brand.** Violates INV-17 (one image digest per release) and INV-18 (no
  tenant-specific code paths).
