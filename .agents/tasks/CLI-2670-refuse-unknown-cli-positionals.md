---
title: 'CLI-2670: Refuse unknown CLI positionals instead of silently starting a session'
issue: https://github.com/woojubb/robota/issues/2670
status: todo
created: 2026-09-20
priority: medium
urgency: next
area: packages/agent-cli
depends_on: []
---

# CLI-2670: Refuse unknown CLI positionals instead of silently starting a session

## Objective

`PARSE_ARGS_CONFIG` sets `allowPositionals: true` and exactly four positionals are branched on —
`init`, `user-local`, `eval`, `session analyze`. Every other positional falls through and the CLI
starts an ordinary interactive session in the current directory, **discarding the arguments with no
message**. `robota opne <url>`, `robota whatver`, or a subcommand from a newer version all look like
they worked. This is the `Silence is not success` failure shape: the third state (could not
understand the request) is collapsed into the first (ran normally). Decide and implement what an
unrecognised positional does.

## Plan

- [ ] TC-01: Pin today's behaviour in a test — an unknown positional starts a session and the token is discarded silently.
- [ ] TC-02: Decide the contract (refuse with a usage line and a non-zero exit, versus start and warn) and record the reasoning, including what happens to a bare `robota` with no positional.
- [ ] TC-03: Implement it without breaking the four recognised positionals, the flag forms, or a prompt passed through stdin.
- [ ] TC-04: Cover the near-miss case (`robota opne`) and the newer-subcommand case, so the message tells the user which it is.

## Test Plan

Unit tests over the argument contract for recognised, unrecognised and empty positionals, plus a
process-level check that the exit code and stream match the decision.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (>= 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

Run the built CLI with a misspelled subcommand and observe that it says so and exits non-zero rather
than starting an unrelated session.

## Notes

Found by `proposal-reviewer` on 2026-09-20 while reviewing FLOW-2006, whose `robota open <url>`
invocation is today one of the silently-discarded positionals. FLOW-2006 adds the `open` route and
does not fix the wider contract; this record owns that. Registered on the CLI/TUI umbrella
[issue #2670](https://github.com/woojubb/robota/issues/2670).
