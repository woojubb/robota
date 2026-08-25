---
title: 'HARNESS-119: merge verifier rejects acknowledged or superseded check failures'
issue: https://github.com/woojubb/robota/issues/2305
status: done
completed: 2026-08-25
created: 2026-08-24
priority: high
urgency: now
area: .claude/agents, scripts/harness
depends_on: []
---

# HARNESS-119: merge verifier rejects acknowledged or superseded check failures

## Objective

Make the mandatory post-merge verifier judge the same effective required-check disposition that
authorized the merge. Today its contract says to inspect unfiltered `gh pr checks` output and treats a
red check as a finding, even when the current required-check set is green because a later attempt or the
repository's explicit `review-findings-acknowledged` disposition replaced the blocking result.

The contradiction is reproduced by PR #2160: it merged to `develop` with required `review-gate` green,
the acknowledgement label present, and a recorded disposition, while unfiltered `gh pr checks 2160`
still reports a historical CodeQL failure. `gh pr checks 2160 --required` reports all 11 required
contexts green. A verifier following its current prose literally therefore returns FAIL for a merge the
merge gate legally authorized.

This issue is one Task because both symptoms—a superseded retry and an acknowledged review finding—share
one cause and one independently verifiable outcome: the verifier reads raw check history instead of the
host's effective required-check result set.

## Plan

- [x] TC-01: Define one fail-closed source of truth for the effective required checks on the merged PR.
- [x] TC-02: Update `merge-verifier` so historical/advisory checks do not override that source of truth, while
      any current required failure or pending result still prevents PASS.
- [x] TC-03: Add a semantic harness test that fails if the verifier regresses to unfiltered check history or
      permits an unacknowledged current required failure.
- [x] TC-04: Re-run the verifier against PR #2160 as the observed acknowledged case and a current all-green PR.

## Test Plan

- Unit/contract fixtures cover: all required checks green; a historical non-required failure beside a
  green required replacement; and a current required failure/pending state that must remain blocking.
- Run the targeted harness contract test, the complete harness contract tier, and `pnpm harness:scan`.
- Read-only live verification compares `gh pr checks 2160` with `gh pr checks 2160 --required` and
  confirms the revised verifier contract reaches PASS from the latter without hiding the former.

## User Execution Test Scenarios

Not applicable. This changes an internal repository guardian and its governance tests; it does not
deliver runnable Robota CLI, TUI, browser, or public SDK behavior. The live GitHub comparison belongs
to the engineering verification plan above.

## Evidence

- TDD RED: the first targeted run failed the five newly added merge-verifier contract cases; the
  wrapped-Markdown fixture then reproduced two additional failures before the regex was corrected.
- Targeted GREEN: `pnpm exec vitest run scripts/harness/__tests__/scan-review-findings.test.mjs` —
  16/16 tests passed after the local-review coverage additions.
- Required section regression: `scan-spec-user-execution-section.test.mjs` — 12/12 tests passed after
  the independent scenario author returned `SCENARIO DRAFTED: not-applicable | 0`.
- Full contract tier: `pnpm harness:test:contracts` — 177/177 files and 3802/3802 tests passed.
- Full scan: `pnpm harness:scan` — 143 scans passed, 2 policy-defined scans skipped, zero failures.
- Live PR #2160: raw `gh pr checks 2160` exited 1 on retained CodeQL history; the required-only query
  exited 0 with all 11 required contexts passing for head
  `1c61fef66926aea72ede318b75ab0ba9a7bfff8d`.
- Live current control: `gh pr checks 2304 --required` exited 0 with all 11 required contexts passing.
- Conformance: code→spec 4 assertions checked; spec→code 4 assertions checked; zero gaps.

## Result

The post-merge verifier now judges the exact PR head's current required-check projection, fails closed
on any current required non-success state, and keeps raw or historical checks diagnostic-only. The
review-findings scan and 16 contract tests mechanically guard those semantics, including required
`review-gate` ownership of acknowledgement.
