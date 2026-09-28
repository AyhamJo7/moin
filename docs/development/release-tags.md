# Release tags

Every release is identified by an **annotated, signed** git tag on a commit that is already on
`main`. A lightweight tag carries no author, no date and no message, so it cannot answer "who
released this, when, and from what" months later during an incident — and it cannot be signed.

## Format

```text
v<major>.<minor>.<patch>
```

Semantic versioning. Pre-release candidates are `v1.4.0-rc.1`. There is no `latest` tag: a moving
tag makes "which code is in production" unanswerable, which is exactly the question an incident
asks first.

## Creating one

```bash
git switch main && git pull --ff-only
git tag --sign --annotate v0.3.0 --message "$(cat <<'MSG'
v0.3.0 — voice reception pilot slice

Release manifest: docs/operations/releases/v0.3.0.md
Image digest: sha256:...
MSG
)"
git push origin v0.3.0
```

The tag message names the release manifest and the image digest. **One image digest per release**
(INV-17): the same digest runs every role, started with a different command. A tag that points at
code which was rebuilt into a different digest is not a release, it is a coincidence.

Tag messages follow A-22 like every other git object: no AI-tool mentions, no attribution trailers.

## Signing

Tags are signed so a tag's provenance can be checked without trusting the transport:

```bash
git config --global user.signingkey <key>
git config --global tag.gpgSign true      # or gpg.format ssh + user.signingkey <path>
git tag --verify v0.3.0
```

`git tag --verify` must succeed before a tag is used to cut a release. An unsigned or unverifiable
tag is deleted and recreated, never "accepted this once".

## Who

Tagging is a **founder action**, like merging to `main` and applying rulesets. A session prepares
the release manifest and the notes; it does not create, move or push tags.

## Immutability

A pushed tag is never moved or deleted. A mistake becomes the next patch version. Tag deletion is
blocked by the ruleset on `main`'s tag namespace for the same reason force-pushes are: something
that was already fetched cannot be un-published, only contradicted.

## Relationship to gates

A tag is cut only after **QG-04** (pre-release) passes on that exact SHA: QG-01 and QG-03 green,
SBOM and provenance attestation produced, staging deployed and smoke-tested, migration rehearsal
done when the schema changed, release manifest and notes written. The tag records the result; it
does not stand in for it.
