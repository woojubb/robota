---
title: 'HARNESS-106: hook-parsing tests reach the network, so a GitHub outage reads as a parsing regression'
status: todo
created: 2026-08-17
priority: medium
urgency: soon
area: scripts/harness, .claude/hooks
depends_on: []
---

# HARNESS-106: hook-parsing tests reach the network

`scripts/harness/__tests__/branch-guard-aliases.test.mjs` and
`scripts/harness/__tests__/hook-command-parsing.test.mjs` invoke the real hooks, and those hooks call
`gh pr list` / `gh pr view` with a 10-second budget. When GitHub is slow or unreachable, the tests
time out and report failure.

## Why this is a defect and not a flake to be tolerated

What these tests verify is **command parsing** — that the guard sees a `create` flag through an
alias, reads a branch name out of a quoted `checkout`, spots a delete however the flag is ordered.
None of that is a question about GitHub. The suite's verdict nonetheless depends on GitHub answering
within ten seconds, so a network condition is indistinguishable from a parsing regression.

Measured on 2026-08-17 during unrelated work: **3 to 5 failures across the two files, and the failing
subset changed between consecutive runs of the same tree** — with the working changes stashed, the
failures reproduced. That variability is the whole problem: a suite whose red set is not a function
of the code cannot be used to judge the code, and the first instinct on seeing it is to assume the
tests are "just flaky" and stop reading them. The next real regression in hook parsing lands in that
blind spot.

It also cost time in the session that found it: several minutes went to proving the failures were
not caused by the change under review.

## The shape of the fix

The hooks are right to consult GitHub — a guard that cannot tell a merged branch from an unmerged one
must fail closed, and this repository's `branch-guard` / `merge-gate` / `pre-push-check` all do. The
problem is that the _parsing_ tests inherit that dependency.

Candidate approaches, to be settled in the spec:

1. **Separate the parser from the caller.** If command parsing is reachable without executing the
   hook's GitHub path, the parsing tests call the parser directly and never reach the network. This
   is the structurally correct answer and the one to try first.
2. **Inject a `gh` stub.** Point the hooks at a fake `gh` on `PATH` for the duration of the test, so
   the network path executes deterministically. Cheaper, but it keeps the coupling.
3. **Shorten the hook's budget under test** via an env var. Rejected on sight — it makes the test
   pass faster without making its verdict depend on the code.

Whichever is chosen, the acceptance condition is the same: the two suites must produce identical
results with the network unavailable.

## Test Plan

| TC-ID | Test Type  | Tool / Approach                                                         | Notes                                                                       |
| ----- | ---------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| TC-01 | Unit test  | Run both suites with outbound network blocked                           | The acceptance condition stated as an executable check                      |
| TC-02 | Unit test  | Run both suites twice and compare the failing set                       | The observed defect was a red set that changed between runs                 |
| TC-03 | Unit test  | Assert the parsing cases execute no `gh` subprocess                     | Proves the dependency was removed rather than merely made faster            |
| TC-04 | Regression | Keep one test that DOES exercise the hook's GitHub path, marked as such | The fail-closed behaviour is real and must not be deleted with the coupling |
