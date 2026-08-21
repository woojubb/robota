---
title: 'INFRA-065: the two halves INFRA-059 did NOT deliver — actionlint`s lint pass, and a scheduled re-check for references that rot without a PR'
status: done
completed: 2026-08-21
created: 2026-07-26
priority: medium
urgency: soon
area: .github/workflows, scripts/harness
depends_on: [INFRA-059]
---

# INFRA-065 — what the resolvability guard does not cover, written down instead of implied

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

- [x] A CI job runs `actionlint` over `.github/workflows/*.yml`, proven red against a deliberately
      malformed expression before being believed. The `actionlint` job in `.github/workflows/ci.yml`.
- [x] A NON-BLOCKING job runs the resolvability scan's live half — **on demand, not on a schedule**.
      The cadence is refused rather than pending; see below. `action-references` in
      `.github/workflows/ruleset-drift.yml`.
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

## Progress

### 2026-08-21

**Half 1 — `actionlint`, and my own baseline measurement was wrong in exactly the way this job
guards against.**

I first recorded "ZERO problems across this repository's workflows". That was measured on a machine
with NO SHELLCHECK INSTALLED — under the precise silent skip this job asserts against, taken while
writing the assertion. The CI runner has shellcheck, so the first run of the job went RED and found
three things the local measurement could not see.

Re-measured with shellcheck 0.10.0 present, and the corrected finding is better than the wrong one:

**A `shellcheck disable` directive in `release-desktop-app.yml` was UNPARSEABLE, so it suppressed
nothing and switched off every check on its block.**

```
# shellcheck disable=SC2086 -- $ASSETS is an intentional multi-pattern glob list.
                            ^^ shellcheck cannot parse this form
SC1073: Couldn't parse this shellcheck directive. Fix to allow more checks
```

Verified against shellcheck directly rather than inferred: the `-- reason` form is SC1073, the
`# reason` form and the bare form are both clean. A parse error aborts further checks on the script,
so that block had been unchecked for as long as the directive has been there — and the directive was
written to narrow one rule, not to disable all of them. Exactly the shape this job exists to find,
found on its first run.

The third finding was SC2129 in `review-gate.yml` — three consecutive appends to `$GITHUB_ENV`, now
one grouped redirect, which also makes it visible that the three facts are written together or not
at all.

With those fixed, actionlint WITH shellcheck reports zero, and that is now a measurement rather than
an artefact of a missing tool. Pinned by version AND sha256, verified BEFORE extraction — the shape
INFRA-061 established for the osv-scanner download, and for its reason: a binary verified after it
is made executable is verified too late.

Red-proofed rather than believed, one mutation at a time:

| mutation                                             | actionlint                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `github.base_ref` → `githubb.base_ref`               | `undefined variable "githubb"` [expression]                                                    |
| `${{ github.event.pull_request.title }}` in a `run:` | `is potentially untrusted. avoid using it directly` — the injection shape this half exists for |

**The third red proof produced nothing, and that is the finding.** A shellcheck-visible defect in a
`run:` block drew no comment and actionlint exited **0**. Cause, from its own `-verbose` output:

```
Rule "shellcheck" was disabled: exec: "shellcheck": executable file not found in $PATH
```

Half of what this job is for is the `run:` block check — this repository passes `github.*` values
into shell through `env:` in several places — and without shellcheck present that half turns itself
off silently while the job still passes. So the job ASSERTS shellcheck rather than assuming it:

```
command -v shellcheck >/dev/null || { echo "::error::…silently skipped."; exit 1; }
```

A guard whose second half can disable itself and still report success is the failure shape this
repository keeps finding, and it was one `command -v` away from shipping here.

**A JOB, and two scans argued opposite sides before it settled there.**

`ci-concurrency-footprint` refused the standalone form first: `ci-footprint GREW: 24 job(s) per pull
request, up from a frozen 23`, because concurrent jobs are budgeted per ACCOUNT and each one is a
slot taken from every other repository on it. So it was folded into `scans` — no slot, same coverage.

Then the harness suite refused THAT, twice over, and it was the stronger objection:

- `ci-mirror-map` — every step of a REQUIRED job must be reproduced by a `verify-like-ci` stage or
  declared plumbing. INFRA-056's reason: otherwise "I ran the CI-equivalent check" covers less than
  it claims.
- `pre-push-mirrors-ci-scans` — the pre-push gate must run every command `scans` runs.

Both are satisfiable only by making every developer install actionlint and pay a network download on
every pre-push. That is a worse trade than one account slot, so the job came back and the footprint
baseline was re-frozen deliberately at 24 — which is the option that scan itself offers, alongside
"remove a job" and "merge two".

Recorded because the first commit of this work argued the opposite in its own message: folding in
looked strictly better until the mirror invariant was measured. One account slot, spent knowingly,
against a required context nobody could reproduce locally.

**Half 2 — the cadence is REFUSED, not deferred.** The item asks for a scheduled job. The
2026-08-04 owner directive ("크론은 다 꺼") removed every `schedule:` trigger in this repository, and
there are none today — verified: zero `schedule:` keys across `.github/workflows/`. Reintroducing one
would contradict a standing instruction.

What landed instead is the on-demand form, in `ruleset-drift.yml` — the file this repository already
uses for a live half that must never gate a merge, with the same trigger, permissions and rationale.

**What that does NOT close, stated rather than implied:** on demand is not a cadence. A reference
that rots with no PR is caught when someone runs the job, not within 24 hours. The gap this item
named survives at reduced size, and closing it needs the cron directive revisited — an owner
decision, not work.

`actionlint` over the tree including both new workflows — exit 0.
