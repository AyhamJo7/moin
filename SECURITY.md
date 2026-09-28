# Security

## Reporting a vulnerability

**Do not open a public issue.** Use a
[private security advisory](https://github.com/AyhamJo7/moin/security/advisories/new).

Include what you did, what happened, and what you expected. A proof of concept helps; please do not
test against production, and do not access, modify or retain data that is not yours.

We will confirm receipt, keep you informed while we investigate, and tell you when a fix ships.

## What we protect

This product answers a business's telephone. What flows through it is what a caller says out loud
and what a small business knows about its customers: names, numbers, addresses, appointments, and
the content of conversations. That is ordinary personal data under the GDPR, and some of it —
health-adjacent details a caller volunteers, for instance — is more sensitive than it looks.

## The controls that carry the weight

Each is an invariant rather than a guideline; the full list is
`python3 .claude/bin/plan_section.py --invariants`.

### Tenant isolation (INV-01, INV-02)

Every tenant row carries `organisation_id` under `ENABLE` **and** `FORCE ROW LEVEL SECURITY`, with
policies for every command. The runtime role is `NOBYPASSRLS` and owns no tables, so it cannot
disable a policy even if application code is compromised.

Tenant context is derived **server-side** from the session and set per transaction — never taken
from a request parameter, and never with a session-level `SET`, which would leak onto the next
checkout of a pooled connection. All access goes through `withTenant` / `withSystemWork`.

Isolation is proven adversarially: every tenant table gets cross-tenant `SELECT`, `INSERT`,
`UPDATE` and `DELETE` tests, plus a no-context case that must return zero rows rather than
everything. Tests use real PostgreSQL, because an embedded one runs as superuser and silently
bypasses RLS.

### Secrets (INV-15)

Only in AWS Secrets Manager, referenced by ARN. Never in code, a configuration file, a database row
or a log line. The configuration loader's error path reports the variable name and the expected
shape, never the value, because a validation library's default message will print what it rejected
— and that is how a connection string with a password reaches a boot log.

### Personal data in telemetry (INV-12)

The logger redacts to an **allowlist**: a field nobody has classified is redacted. A denylist
protects the fields someone remembered to name, and then a later commit logs `{ caller }` and ships
a phone number to a third-party processor with nothing failing. `console.*` is a lint error in
production code because it skips this path entirely.

`from` and `to` are deliberately _not_ allowlisted: in a telephony product those are the caller's
and callee's numbers.

### AI boundaries (INV-04, INV-05, INV-13)

Models hold no credentials and execute nothing. Every tool call is validated by deterministic code
before it runs, and no commitment is made to a caller without a verified tool success. Life-safety
situations get a reviewed deterministic script, never a generated answer.

### Audit (INV-10)

Every business mutation writes an append-only, hash-chained audit event. There is no update or
delete path, by construction.

### Supply chain

Dependencies are installed with a frozen lockfile; lifecycle scripts are blocked unless explicitly
allowlisted with a reason, because an unreviewed `postinstall` is arbitrary code execution on every
developer machine and CI runner. Every GitHub Action and container image is pinned by SHA or digest
— a tag is mutable, so a pinned tag is not a pin. Every pull request runs a dependency audit, a
licence check, gitleaks over full history, Semgrep, Trivy against the filesystem and the built
image, and produces a CycloneDX SBOM.

### The runtime image

Non-root, read-only-root-filesystem compatible, base pinned by digest, and **no package manager**:
`npm`, `npx`, `corepack` and `yarn` ship in the base image and are removed, because a package
manager in a running container is an installer and a network fetcher for anyone who gets code
execution. The build asserts their absence rather than trusting the comment.

## Review

Changes to authentication, sessions, RLS or roles, `SECURITY DEFINER` functions, the tool guard,
webhooks, integrations, billing or privacy handlers require a second review before merge (QG-09).
HIGH and CRITICAL findings are fixed with a regression test proven to catch the defect — they do
not become follow-up tickets.

## What is not in place yet

Stated plainly, because a security document that describes intentions as facts is worse than none:

- **No production environment exists.** Cognito, Secrets Manager, WAF, backups and disaster
  recovery arrive in P05 and P17.
- **No external penetration test** has been performed (P17).
- **No formal privacy review.** The German data-protection review is EXT-02, and the AI-Act
  assessment is P16.
- **Branch protection is not yet active** (EXT-24).

`PLAN.md`'s Status Ledger is the current truth.
