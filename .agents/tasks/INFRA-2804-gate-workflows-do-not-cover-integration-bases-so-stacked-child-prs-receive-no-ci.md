---
title: 'INFRA-2804: Gate workflows do not cover integration/** bases, so stacked child PRs receive no CI'
issue: https://github.com/woojubb/robota/issues/2804
status: in-progress
created: 2026-09-21
priority: medium
urgency: soon
area: ci
depends_on: []
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

The plan is the spec: `.agents/spec-docs/todo/INFRA-2804-gate-workflows-do-not-cover-integration-bases-so-stacked-child-prs-receive-no-ci.md`.

## Plan

One item per TC-N in the spec's Completion Criteria.

- [ ] TC-01 — add `integration/**` to `on.pull_request.branches` in `.github/workflows/ci.yml`,
      widening the list rather than replacing it
- [ ] TC-02 — same for `gitleaks.yml` and `dependency-review.yml` (`on.pull_request.branches`) and
      `workflow-provenance-gate.yml` (`on.pull_request_target.branches`)
- [ ] TC-03 — keep the change trigger-only: no job `if:` condition is modified, proved by the diff
      touching only `branches:` lists. The 20 jobs in `ci.yml` split 4 `base_ref == 'main'` (skip) /
      12 `!= 'main'` (run) / 3 `workflow_dispatch` (skip) / 1 unconditioned path filter, so widening
      alone is sufficient
- [ ] TC-09 — leave every `types:` list byte-identical; INFRA-055 subscribes `edited` because a base
      retarget fires `edited`, not `synchronize`
- [ ] TC-06 — change `.claude/hooks/merge-gate.sh` to refuse a `CLEAN` pull request carrying zero
      repository gate checks, naming that condition instead of reporting green
- [ ] TC-07 — keep the normal path working: a `CLEAN` pull request with passing gate checks is still
      accepted, so the new refusal is not a blanket block
- [ ] TC-08 — `bash -n` on the hook exits 0 and the affected scans report no NEW failure
- [ ] TC-04 — record the live observable on PR #2803 once this lands on `develop`: the `ci.yml` gate
      jobs appear in `gh pr checks`
- [ ] TC-05 — on the same pull request, no `base_ref == 'main'` job reports a non-skipped conclusion

## Test Plan

| TC-ID | Approach                                                                                  | Reference                                    |
| ----- | ----------------------------------------------------------------------------------------- | -------------------------------------------- |
| TC-01 | YAML-parse `ci.yml` and assert the branches array — parsed, not grepped                   | `scripts/harness/__tests__/` (added)         |
| TC-02 | same assertion over the three remaining workflow files                                    | `scripts/harness/__tests__/` (added)         |
| TC-03 | `git diff origin/develop...HEAD -- .github/workflows/ci.yml` touches only `branches:`     | diff assertion in the same test              |
| TC-04 | `gh pr checks 2803` after this lands on `develop`                                          | manual — GitHub dispatch has no local stand-in |
| TC-05 | `gh pr checks 2803` job conclusions                                                        | manual — same reason as TC-04                |
| TC-06 | invoke `merge-gate.sh` against a recorded zero-check `gh` fixture; the hook must refuse    | `scripts/harness/__tests__/` (added)         |
| TC-07 | same harness with a passing-checks fixture; the hook must accept                           | `scripts/harness/__tests__/` (added)         |
| TC-08 | `bash -n .claude/hooks/merge-gate.sh` + `run-all-scans.mjs --affected --context pr`        | command                                      |
| TC-09 | diff assertion that no `types:` line changes in any of the four workflows                  | same test as TC-03                           |

TC-04 and TC-05 are the only manual rows. Both assert GitHub's workflow-dispatch behaviour for a given
base, which no local command can stand in for — a local runner would be asserting over its own
re-implementation of the branch filter rather than over the thing that actually decides.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (>= 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This change alters no Robota product surface. The four contract surfaces are `robota-cli`,
`robota-tui`, `robota-browser-ui` and `public-sdk-example`; this unit edits four GitHub Actions trigger
filters and one git hook, so a person running `robota`, opening the TUI or browser UI, or calling the
public SDK observes byte-for-byte identical behaviour before and after. Its only observable lives on
github.com — which jobs GitHub dispatches for a pull request whose base matches `integration/**` — and
that is a property of the forge, not of the product a user executes. Recording `gh pr checks` as a
product scenario would be a category error: it would assert over GitHub's dispatch decision while
claiming to exercise a Robota surface.

The observable is not lost by this verdict. It is TC-04 and TC-05 in the spec's Completion Criteria,
both marked `manual` in the Test Plan with the infeasibility reason stated there: no local command can
stand in for GitHub's dispatch decision, because a local runner would be asserting over its own
re-implementation of the branch filter rather than over the thing that actually decides.
