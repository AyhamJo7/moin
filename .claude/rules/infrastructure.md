---
paths:
  - "infrastructure/**"
  - "**/*.tf"
  - ".github/workflows/**"
---

# Infrastructure and CI

Read first: `python3 .claude/bin/plan_section.py --section "Infrastructure Architecture"` and
`--section "Terraform layout"`; `--id ADR-0021` (accounts), `--id QG-05`.

- Sessions run `terraform fmt`, `validate`, `init -backend=false`; `plan` is founder-only (needs AWS). `apply`, `destroy`,
  `import`, `state`, `force-unlock`, `taint` and `-auto-approve` are founder-only (hook + deny rules).
- Region eu-central-1; Terraform pinned by `required_version` and `.terraform-version`, providers locked.
- `bootstrap/` (state bucket, KMS, OIDC, CI roles) is applied once, manually, by the founder (EXT).
- Workflows: actions pinned by SHA, `permissions: contents: read` by default, concurrency groups
  (P02.06.06). Image references must resolve: run `python3 .claude/bin/gates.py refs` after edits.
- No credentials in variables, tfvars, workflow files or logs (INV-15); secrets are Secrets Manager ARNs.
