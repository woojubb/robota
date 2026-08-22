---
title: 'INFRA-094: the advisory (non-blocking) patch-coverage job runs ~206s on every code PR and rebuilds all deps itself instead of reusing the build job dist — take it off the develop-PR critical path or make it reuse dist'
status: done
completed: 2026-08-21
created: 2026-08-14
priority: medium
urgency: soon
area: .github/workflows/ci.yml, scripts/harness/check-patch-coverage.mjs
depends_on: []
---

# INFRA-094: advisory patch-coverage off the PR critical path

## Problem

`patch-coverage (advisory)` is a non-blocking job — its result does not gate merges — yet it runs
~206s on every code-changing develop PR, and it performs its OWN `pnpm build:deps` (a full workspace
build) that duplicates the `build` job's work because the two do not share a dist artifact. It is
one of the four ~200s parallel jobs that set the develop-PR wall-clock floor at ~4 minutes, and it
adds Actions billing for advisory data that never blocks anything.

## Evidence (measured from PR #1709 / PR #1707 CI runs, 2026-08-14)

- `.github/workflows/ci.yml` `patch-coverage` job: `name: patch-coverage (advisory)`; `if:
!cancelled() && github.base_ref != 'main' && (needs.changes.result != 'success' ||
needs.changes.outputs.code == 'true')` — advisory, code-gated (correctly skips docs-only), but runs
  fully on every code PR.
- Step "Build workspace packages (affected suites import sibling dist)":
  `if: steps.detect.outputs.affected == 'true'` → `run: pnpm build:deps` — a second full dep build,
  independent of the `build` job's output (no shared/artifact-restored dist).
- Timing: patch-coverage = 206s (PR #1709), 208s (PR #1707) — comparable to `build` (200s) and `scans`
  (234s), all running in parallel.

## Direction

Pick one (owner decision), both reduce the develop-PR wall-clock floor:

- **(a) Move it off the per-PR critical path** — run patch-coverage on a schedule (nightly, like
  INFRA-042's mutation testing) or as a non-blocking post-merge job. Advisory coverage data does not
  need to be on the PR's wall-clock, and this removes ~206s + a redundant build from every code PR.
- **(b) Keep it per-PR but stop it rebuilding** — consume the `build` job's dist via
  `actions/upload-artifact`/`download-artifact` (the `quality` and binary-e2e steps already restore
  dist this way), so patch-coverage reuses the build instead of running its own `pnpm build:deps`.
  Cuts the job's time by the build share and removes the duplicate compile.

Coordinate with INFRA-046 ("promote advisory gates") — if that item's direction is to make advisory
gates blocking, that argues for (b); if it keeps them advisory, (a) is the cheaper win.

## Test Plan

- (a): patch-coverage no longer appears as a check on a code PR (or appears as a non-blocking
  scheduled run); develop-PR wall-clock floor drops by ~200s; a nightly run produces the coverage
  report.
- (b): the patch-coverage job's "Build workspace packages" step is replaced by a dist artifact
  restore; the job's wall-clock drops by the build share; coverage numbers are unchanged vs the
  current run on a sample PR.
- `pnpm harness:scan` (workflow-lint / ci-mirror scans) stays green.

## User Execution Test Scenarios

Not applicable — CI-configuration change with no user-facing product runtime behavior. Verification is
the CI-timing / check-presence comparison in the Test Plan (before vs after on a sample code PR, and
the nightly run for option a).

## Progress

### 2026-08-21

**Option (a) is unavailable, so the choice this item framed as an owner decision has one arm.** (a)
moves the job onto a schedule; the 2026-08-04 owner directive ("크론은 다 꺼") removed every
`schedule:` trigger in this repository and there are none today, so proposing one would contradict a
standing instruction. That reduces the decision to (b), which is taken.

**(b) as landed.** `patch-coverage` now RESTORES the `package-dist` artifact `build` already produced
— the same artifact `quality` and the binary e2e restore — instead of running its own
`pnpm build:deps`. `build` joins its `needs` so the artifact exists.

**The trade is stated, not hidden.** Total compute falls by a whole workspace build per code pull
request. In exchange this job can no longer start before `build` finishes. It is advisory and blocks
nothing, so what that costs is a later advisory verdict rather than a later merge — which is the
right side of the trade for a job whose own exclusion reason in
`.github/required-status-checks.json` is that it deliberately cannot fail.

**The fallback is not belt-and-braces.** `build.outputs.package_dist_required` is `build`'s judgement
about whether the CHANGE needs built output; this job's `detect` answers a different question —
whether the changed LINES live in packages whose suites import sibling dist. The two can disagree,
and coverage computed against absent dist would under-report in SILENCE, which is the vacuity this
repository refuses. So `pnpm build:deps` still runs in exactly that case, and only there.

**On the measurement, and a correction to what I first wrote here.** The item's own Evidence section
already records the number and its source: 206s on PR #1709 and 208s on PR #1707, against `build` at
200s in the same runs. My first draft of this entry said the figure "could not be reproduced from
recent history" — which was true of the eight most recent runs (all docs/harness changes where
`detect` finds nothing: `patch-coverage` 30–43s, `build` 3–6s) and misleading as a statement about
the item, whose measurement was taken on code PRs and is right there.

That 200s `build` figure also sharpens the trade above: the duplicated work this removes is roughly
the whole of `build`, and the serialisation it adds is roughly the same 200s of waiting. Compute
falls by about half of this job; wall-clock for an ADVISORY verdict moves later by about as much.
Worth taking because the verdict blocks nothing — and worth stating, because "cuts the job's time by
the build share", as the item's option (b) puts it, is only half of what happens.

The change that carries this item IS a code change across five packages, so its own CI run is a
representative reading, and the Test Plan's check ("the 'Build workspace packages' step is replaced
by a dist artifact restore") is readable directly from it.

`actionlint` — exit 0. `pnpm harness:scan` — 129 passed, 2 skipped.
