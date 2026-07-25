---
title: 'INFRA-048: PRs can merge before their review feedback is ever read'
status: todo
created: 2026-07-25
priority: high
urgency: soon
area: .github/workflows, repo rulesets, .agents/rules
depends_on: []
---

# INFRA-048: armed auto-merge outruns the review loop

## Problem

Observed on **#1409** (2026-07-25): CodeQL's inline review posted at `13:33:04Z`, the PR merged at
`13:34:18Z`, and the flagged defect — two unused imports in `scripts/perf/compare-typecheck.mjs` —
**landed on `develop`**. The fix had to be re-applied afterwards as #1410.

The reviews were not late. They arrived **74 seconds before** the merge. The failure is that **nothing
in the pipeline requires anyone to read them.**

Root cause: the required status checks that gate a merge are

```
build, quality, scans, security audit, commitlint, tui-e2e, examples-typecheck, windows-shell
```

(`protect-develop` ruleset). **Not one of them produces review feedback.** The two jobs that do —
`Claude review` and CodeQL's `Analyze (javascript-typescript)` — are advisory. So an armed auto-merge
fires the moment the eight gates go green, regardless of what the review jobs are about to say, or have
just said. `Claude review` itself finishes in ~14 s and reports `pass` whether or not it left findings,
so even watching that check tells you nothing.

This is a systemic gap, not an operator slip: the orchestration procedure arms auto-merge as soon as a PR
is opened, and there is no point at which the review output is a gate.

## What

Decide and implement one of these (they are not exclusive):

1. **Make the review-producing checks required** for `develop` — at minimum CodeQL's analysis job, so a
   PR cannot merge while its analysis is still pending. Coordinate with INFRA-046, which is already
   tracking advisory→required promotion criteria and its "flip the flag AND add to the ruleset" lesson.
2. **Make `Claude review` fail (not just comment) when it emits actionable findings**, so its check
   status carries information. Today it passes unconditionally.
3. **Change the orchestration procedure**: do not arm auto-merge until review output has been read.
   The `worktree-parallel-orchestration` skill currently says "merge PRs one at a time via armed
   auto-merge" with no review-reading step — add one (neutral wording: "read whatever review feedback
   the project's review automation produces before arming the merge").

Option 3 is the cheapest and closes the loop immediately; 1 and 2 make it mechanical rather than
procedural, which is the stronger fix per the recurring-mistake-prevention principle.

## Test Plan

Reproduce the class: open a PR containing a defect the review automation reliably flags (e.g. an unused
import in a path outside eslint's scope — `scripts/` is such a path, which is exactly why #1409's defect
survived lint). Confirm that under the chosen fix the PR **cannot** merge until the finding is addressed
or explicitly dismissed. Then confirm a clean PR still merges without extra friction — the gate must not
become a permanent stall.
