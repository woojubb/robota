---
title: 'CORE-017: IRunOptions dead-field audit — stream/toolChoice unthreaded; every advertised run option must work or fail loudly'
status: todo
created: 2026-07-04
priority: high
urgency: soon
area: packages/agent-core
depends_on: []
---

# IRunOptions dead-field audit

Follow-on from the CORE-016 external bug report (`.design/bug-report-maxtokens-2026-07-03.md`
제안 3 — silent-ignore mitigation, generalized). CORE-016 fixed `maxTokens`/`temperature`, but a
grep sweep of `robota-execution.ts` + `execution-*.ts` for `options.stream` / `options.toolChoice`
/ `context.toolChoice` returns EMPTY — `IRunOptions.stream` and `IRunOptions.toolChoice` are
advertised on the public interface yet never threaded into any execution context or provider call.
Same defect class the report exposed: a typed, documented option the runtime silently ignores.

## What

1. **Full-surface audit**: for every field on `IRunOptions`, trace the threading path
   (buildRunContext / runStream inline context → `IExecutionContext` →
   `buildFullExecutionContext` → provider call sites, per the CORE-011/CORE-016 lesson: the
   helper is the easy-to-miss seam). Produce a table: field → threaded? → consumer.
2. **Policy — no silent ignores**: each dead field must be either (a) wired end-to-end with
   regression tests (CORE-016 pattern: mock provider asserts chatOptions), or (b) removed from
   the interface. This repo is unreleased with a no-backward-compat, no-deprecated policy —
   removal is a first-class option; a warning log is NOT an acceptable terminal state.
3. **Regression guard**: for every field kept, a threading assertion test (run + runStream);
   consider a type-level or test-level exhaustiveness check over `keyof IRunOptions` so a future
   field cannot ship unthreaded.

## Known dead fields (verified 2026-07-03 by grep)

- `stream` — no reads anywhere in execution services.
- `toolChoice` — no reads anywhere in execution services.
- (Audit may find more; the table in item 1 is the deliverable that proves completeness.)

## Test Plan

- Unit: threading assertions per kept field (mock provider records chatOptions), run × runStream.
- Exhaustiveness: test iterating `keyof IRunOptions` against the audited table.
- Full core suite + typecheck + harness scans green.

## User Execution Test Scenarios

- Prereq: consumer script in `scratch/src/` with a real provider key
  (`packages/agent-cli/.env` ANTHROPIC_API_KEY).
- Steps: for each kept-and-wired field, one live call demonstrating the option observably
  changes provider behavior (e.g. `toolChoice` forcing/suppressing a tool call); for each
  removed field, `tsc` rejection of the removed option in a consumer snippet.
- Expected: every advertised option has an observable effect; no option compiles yet silently
  no-ops.
- Evidence: (record after execution)
