---
title: 'ANALYTICS-001: Record source-attributed token usage in the session log + reporting + test assertions'
status: in-progress
created: 2026-07-01
priority: medium
urgency: soon
area: packages/agent-core, packages/agent-framework, packages/agent-session-analytics, packages/agent-interface-transport, packages/agent-cli
depends_on: []
---

> **Phase 1 delivered (2026-07-01):** the usage type + reducer + report + CLI + harness assertions, with
> main-thread usage attributed today. **Phase 2 (remaining):** record _live_ subagent/background-task
> usage into the main session log with its source so multi-source attribution is populated end-to-end
> (the reducer/CLI/harness already consume it). Confirmed decisions: D1 minimal `IUsageSource` in
> agent-interface-transport (the framework's `IExecutionOrigin` is a layer up and can't be imported into
> the contract package); D2 single usage stream in the main session log; D3 `robota session analyze
--usage` report; D4 harness `usageReport()`/`totalUsage()`.

# Source-attributed token usage in the session log

## Problem / goal

Token usage exists per assistant message (`agent-core` `token-usage.ts` / `execution-usage.ts` →
`IAssistantUsageMetadata`), but it is **not attributed to a source** and **not recorded in the session
log** in a way that can be queried later. So we cannot answer "in this session, which part burned the
most tokens — the main thread, a specific subagent, or a background task?", and the testing framework
cannot assert on token usage to catch wrong/excessive consumption (e.g. a runaway background agent).

Goal: every token-consuming unit of work records its usage **attributed to its source** into the
session log, a reporter can re-read a session log and break usage down by source, and the testing
framework can assert usage budgets so regressions in token consumption are caught.

## What

1. **Source-attributed usage records (SSOT).** Define a usage record that carries the existing
   `IAssistantUsageMetadata` (input/output/total tokens) plus a **source descriptor** reusing the
   existing execution-origin model (`IExecutionOrigin`: main_thread / subagent+id / background task+id
   / tool_call / command / skill) so attribution is not a new parallel taxonomy. One owner type; no
   duplicate token shapes (extend, don't fork).
2. **Persist into the session log.** Append these usage records to the session log alongside history
   entries (main thread) and the subagent/background-task loggers (`assembly/subagent-logger.ts`,
   `background-tasks/*`), so a completed session log is self-describing for usage. Append-only,
   read-only (consistent with history).
3. **Reporting / query API.** In `agent-session-analytics`, add a reducer over a session log/record
   that returns a per-source usage breakdown (totals + top consumers, e.g. "background task <id>:
   X tokens (Y% of session)"), plus a CLI/printed report surface so a user can see where tokens went.
4. **Testing-framework assertions.** Expose the breakdown through the scripted-session / PTY harness
   (TEST-003 / TEST-010) so a test can assert "total session usage ≤ N", "no single background task
   exceeds M", or "main-thread vs subagent split is within bounds" — turning wrong token usage into a
   failing test / CI gate.

## Design notes / decisions to confirm before implementation

- **D1 — attribution key:** reuse `IExecutionOrigin` (recommended — one taxonomy already drives the
  execution workspace) vs a new usage-only source enum.
- **D2 — record location:** one usage stream in the main session log (recommended) vs per-subagent
  logs aggregated at read time. Trade-off: single log is simplest to report; per-subagent matches the
  existing subagent-logger split.
- **D3 — report surface:** a `/usage` (or `dag`-style) CLI report + a programmatic reducer
  (recommended) vs reducer-only (tests/SDK only).
- **D4 — test assertion API:** harness helper like `harness.usageBySource()` / `harness.totalUsage()`
  returning the breakdown for `expect(...)`.

(Confirm these — and the exact budgets/thresholds the tests should enforce — before building, per the
"define the scenario properly first" rule.)

## Test Plan

- Unit: the usage reducer aggregates a fixture session log into the correct per-source totals and
  percentages; ties/empty/zero-usage handled.
- Functional (TEST-003 scripted-session): a scripted run with a subagent + a background task produces
  a session log whose usage breakdown attributes tokens to each source; `harness.usageBySource()`
  returns them; an over-budget run fails an assertion.
- typecheck / lint / `pnpm harness:scan` green; reuse, don't fork, the token-usage SSOT.

## User Execution Test Scenarios

- Prereq: built CLI; a session that runs the main thread + spawns ≥1 subagent/background task.
- Steps: run `robota`, do work that spawns a background agent, then run the usage report (e.g.
  `/usage` or the documented report command) against the session.
- Expected: the report lists token usage broken down by source (main thread vs each agent/background
  task) with totals and a clear "top consumer", matching what was run.
- Evidence (Phase 1, agent-run): `agent-session-analytics` reducer unit tests (per-source breakdown,
  percentages, top consumer, empty); `agent-cli` `session analyze --usage` integration test (prints the
  source breakdown + top consumer); `agent-framework` `usage-assertion-functional` drives a REAL session
  whose scripted provider reports usage and asserts `harness.usageReport()`/`totalUsage()` + a budget.
  All green; lint 0 errors; `pnpm harness:scan` 39/39. **Live multi-source attribution (subagent /
  background task usage written to the main log) is Phase 2** — until then a real session's report shows
  main-thread usage (the subagent/background rows populate once Phase 2 records them).
