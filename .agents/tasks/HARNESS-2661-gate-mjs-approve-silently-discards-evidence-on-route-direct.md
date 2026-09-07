---
title: 'HARNESS-2661: gate.mjs approve silently discards --evidence on route DIRECT'
issue: https://github.com/woojubb/robota/issues/2661
status: in-progress
created: 2026-09-07
priority: medium
urgency: soon
area: harness
depends_on: []
---

# HARNESS-2661: gate.mjs approve silently discards --evidence on route DIRECT

## Objective

Stop `gate.mjs approve` from accepting `--evidence` on route DIRECT and dropping it without a word,
and close the same accept-and-drop shape across the whole CLI. `runApprove` bound `evidence` only
inside the CLASS branch, so a DIRECT approval carrying a scope note recorded nothing and still exited
0 — the operator believed provenance was written, the guard read an entry that carried none, and
neither was told. `parseArgs` validated no flag against the named subcommand, so `judge --rule` and
every misspelling were dropped the same way.

The contract chosen is REFUSAL, not recording: a DIRECT entry carries what the user said, so an
agent-authored note may not stand as evidence of the scope of the agent's own authority.

## Plan

- [x] Reproduce the drop and prove the regression tests red before the fix
- [x] `runApprove` refuses `--evidence` and `--conversation` on route DIRECT, naming the alternatives
- [x] `parseArgs` refuses any flag the named subcommand does not read (the rule `new-spec.mjs` applies)
- [x] `gate-cli.mjs` usage agrees with the implementation — `--evidence`/`--conversation` marked
      CLASS-only, the unused `judge --rule` dropped
- [x] Split the parser into `gate-arguments.mjs` so the evaluator file does not grow past its
      file-size baseline, and tighten the baseline to the shrunk size
- [x] Regression tests in `scripts/harness/__tests__/gate.test.mjs`, green

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This change is confined to the repository's internal harness gate CLI, which ships in no
published package and is reachable from no Robota product surface — not the SDK, the agent runtime,
any transport, the CLI a user installs, or the web UI. No end user can run it, so there is no
runnable user-facing behaviour whose change a user could observe; the engineering test plan
(TC-01 to TC-05) carries the verification evidence instead.
