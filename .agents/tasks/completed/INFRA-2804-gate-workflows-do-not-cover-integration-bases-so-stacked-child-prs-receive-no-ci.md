---
title: 'INFRA-2804: Gate workflows do not cover integration/** bases, so stacked child PRs receive no CI'
issue: https://github.com/woojubb/robota/issues/2804
status: done
created: 2026-09-21
priority: medium
urgency: soon
area: ci
depends_on: []
completed: 2026-09-21
---

# INFRA-2804: Gate workflows do not cover integration/** bases, so stacked child PRs receive no CI

## Objective

Give pull requests whose base matches `integration/**` the same CI gates that `develop` and `main`
pull requests get, and make `merge-gate.sh` able to tell "the checks passed" apart from "there were
no checks".

Measured on PR #2803 (`feat/mcp-001-typed-control-plane` → `integration/agreement-014`): its entire
check list is three Cloudflare Pages deploy previews and one skipped job, while `gh pr view` reports
`mergeStateStatus: CLEAN`. The merge gate's first question — "Is CI green?" — is therefore answered
`CLEAN` by a pull request that ran no gate at all.

Spec: `.agents/spec-docs/done/INFRA-2804-gate-workflows-do-not-cover-integration-bases-so-stacked-child-prs-receive-no-ci.md`

## Plan

One item per TC-N in the spec's Completion Criteria.

TC-04 and TC-05 are deliberately absent. They named a live observation on PR #2803, which was
merged before this Task's planning checkpoint was written, so the item could never be satisfied as
worded. They are withdrawn from the Completion Criteria rather than carried as a tick over work
that cannot be done — see the spec's Decision.

- [x] TC-01 — add `integration/**` to `on.pull_request.branches` in `.github/workflows/ci.yml`,
      widening the list rather than replacing it
- [x] TC-02 — same for `.github/workflows/gitleaks.yml`, `.github/workflows/dependency-review.yml`
      and `.github/workflows/review-gate.yml` (`on.pull_request.branches`), and
      `.github/workflows/workflow-provenance-gate.yml` (`on.pull_request_target.branches`)
- [x] TC-03 — keep the change trigger-only: no job `if:` condition is modified, proved by the diff
      touching only `branches:` lists. The 20 jobs in `ci.yml` split 4 `base_ref == 'main'` (skip) /
      12 `!= 'main'` (run) / 3 `workflow_dispatch` (skip) / 1 unconditioned path filter, so widening
      alone is sufficient
- [x] TC-09 — leave every `types:` list byte-identical across all five widened triggers; INFRA-055
      subscribes `edited` because a base retarget fires `edited`, not `synchronize`
- [x] TC-06 — change `.claude/hooks/merge-gate.sh` so a candidate carrying zero repository gate
      checks is refused by name instead of being read as green
- [x] TC-07 — keep the normal path working: a candidate with passing gate checks is still accepted,
      so the new refusal is not a blanket block
- [x] TC-08 — `bash -n` on the hook exits 0 and the affected scans report no NEW failure

## Test Plan

| TC-ID | Approach                                                                                  | Reference                                    |
| ----- | ----------------------------------------------------------------------------------------- | -------------------------------------------- |
| TC-01 | YAML-parse `ci.yml` and assert the branches array — parsed, not grepped                   | `scripts/harness/__tests__/` (added)         |
| TC-02 | same assertion over the four remaining workflow files                                    | `scripts/harness/__tests__/` (added)         |
| TC-03 | exact-equality parse: each trigger's `branches` equals the three bases                      | parse assertion; the one-time diff is in the Evidence Log |
| TC-06 | invoke `merge-gate.sh` against a recorded zero-check `gh` fixture; the hook must refuse    | `scripts/harness/__tests__/` (added)         |
| TC-07 | same harness with a passing-checks fixture; the hook must accept                           | `scripts/harness/__tests__/` (added)         |
| TC-08 | `bash -n .claude/hooks/merge-gate.sh` + `run-all-scans.mjs --affected --context pr`        | command                                      |
| TC-09 | exact-equality parse: each trigger's `types` equals that workflow's own list, across all five | `toEqual`, not `toContain` — a dropped or added event reddens |

No manual rows remain. TC-04 and TC-05 were withdrawn at GATE-VERIFY: they asserted GitHub's
workflow-dispatch behaviour on PR #2803, which had already been merged when they were written, so no
run of them was possible. See the spec's Decision.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (>= 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This change alters no Robota product surface. The four contract surfaces are `robota-cli`,
`robota-tui`, `robota-browser-ui` and `public-sdk-example`; this unit edits five GitHub Actions trigger
filters and one git hook, so a person running `robota`, opening the TUI or browser UI, or calling the
public SDK observes byte-for-byte identical behaviour before and after. Its only observable lives on
github.com — which jobs GitHub dispatches for a pull request whose base matches `integration/**` — and
that is a property of the forge, not of the product a user executes. Recording `gh pr checks` as a
product scenario would be a category error: it would assert over GitHub's dispatch decision while
claiming to exercise a Robota surface.

The observable is deferred, not discarded. It was carried as TC-04 and TC-05 until GATE-VERIFY
withdrew them, and now belongs to the first child opened against an integration branch once these
triggers are on the base — recorded on issue #2804. No local command can stand in for it: a local
runner would assert over its own re-implementation of the branch filter rather than over the thing
that actually decides.
