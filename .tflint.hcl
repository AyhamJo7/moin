# P02.02.08 — Terraform linting.
#
# The AWS ruleset is not enabled yet: no Terraform exists until P05, and a ruleset that lints
# nothing gives a false sense of coverage. P05.01 enables `ruleset.aws` in the same commit that
# adds the first module, so the rules and the code they check arrive together.

plugin "terraform" {
  enabled = true
  preset  = "all"
}

config {
  call_module_type = "local"
  force            = false
}

rule "terraform_required_version" {
  enabled = true
}

rule "terraform_required_providers" {
  enabled = true
}

# Unpinned provider or module sources make a plan unreproducible: the same code resolves to
# different providers on different days, which is exactly what INV-17 forbids for releases.
rule "terraform_module_pinned_source" {
  enabled = true
  style   = "semver"
}

rule "terraform_naming_convention" {
  enabled = true
  format  = "snake_case"
}

rule "terraform_documented_variables" {
  enabled = true
}

rule "terraform_documented_outputs" {
  enabled = true
}

rule "terraform_typed_variables" {
  enabled = true
}

rule "terraform_unused_declarations" {
  enabled = true
}
