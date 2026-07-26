---
title: 'INFRA-064: the two halves INFRA-059 did NOT deliver — actionlint`s lint pass, and a scheduled re-check for references that rot without a PR'
status: todo
created: 2026-07-26
priority: medium
urgency: soon
area: .github/workflows, scripts/harness
depends_on: [INFRA-059]
---

# INFRA-064 — what the resolvability guard does not cover, written down instead of implied

INFRA-059 shipped `scripts/harness/scan-action-references.mjs`: every `uses:` reference is resolved
against the real remote, and an unresolvable one is a finding. That closed the defect it was filed
for. It did **not** close two things its own acceptance text implied, and this item exists so the
gap is a tracked item rather than a silent narrowing.

## Half 1 — `actionlint`'s actual subject

INFRA-059's acceptance criterion 1 said "a CI job runs `actionlint` over every workflow". What
landed verifies **resolvability**, which is what caught `vercel/action@v1` and which `actionlint`
does **not** check (INFRA-059 records that measurement). The reverse is also true: `actionlint`
checks things the resolvability scan does not, and those are now uncovered:

- expression syntax and context typing (`${{ }}` referencing a context that does not exist);
- `run:` block shellcheck — this repository's workflows pass `github.*` values into shell through
  `env:` in several places, which is where an injection lives if one ever lands;
- job/step schema errors that GitHub accepts silently.

`actionlint` is a single Go binary with no repo-specific configuration. The reason INFRA-059 did not
add it is not technical: adding a CI job was outside the executing agent's file ownership.

## Half 2 — a reference rots without a PR

Every check INFRA-059 added runs at PR time. But an action reference decays with **no diff at all**:
an upstream repository is deleted or renamed, a tag is force-moved, a repo goes private. `vercel/action`
is exactly that shape — eight months with no PR touching `deploy.yml`. A PR-time check cannot see it,
because there is no PR.

The vehicle already exists: `.github/workflows/ruleset-drift.yml` runs a scan's live half on a cron
so that "an outage costs a red cron, never a blocked promotion". A daily
`node scripts/harness/scan-action-references.mjs --live` in that family catches reference rot within
24 hours and cannot block a merge.

## Acceptance

- [ ] A CI job runs `actionlint` over `.github/workflows/*.yml`, proven red against a deliberately
      malformed expression before being believed.
- [ ] A scheduled (non-blocking) job runs the resolvability scan's live half, proven red by pointing
      it at a reference that does not resolve.
- [ ] Neither job is a required check on `protect-main` — both are cron/advisory by design, for the
      reason `ruleset-drift.yml` states.

## Test Plan

Both halves are workflow-level, so the engineering verification is: run `actionlint` locally over
every workflow and record the output; run the scheduled command locally with `--live`; then prove
each red by introducing the defect it targets in a scratch copy and showing the non-zero exit.
Unit-testable surface is limited to the scan already covered by
`scripts/harness/__tests__/scan-action-references.test.mjs`.

## User Execution Test Scenarios

Not applicable: this item changes CI configuration only. It ships no user-facing surface, no command
behaviour and no runtime behaviour — the observable artefact is a check result on a PR, which the
Test Plan above covers directly.
