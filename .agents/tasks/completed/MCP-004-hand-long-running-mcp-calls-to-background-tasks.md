---
title: 'MCP-004: hand long-running MCP calls to background tasks'
issue: https://github.com/woojubb/robota/issues/2524
status: done
created: 2026-09-03
completed: 2026-09-22
priority: medium
urgency: soon
area: MCP background execution
depends_on: [MCP-002, MCP-003]
---

# MCP-004: hand long-running MCP calls to background tasks

## Objective

Preserve and deliver the independently verifiable outcome of [issue #2524](https://github.com/woojubb/robota/issues/2524) after its redundant child-Issue queue entry is absorbed into the RULE-023 Task graph.

## Source Constraints

- The source Issue remains the complete historical problem and acceptance record.
- Closing it as `NOT_PLANNED` means only that GitHub no longer schedules it independently; this Task remains `todo` until the product outcome is delivered.
- Preserve every security, data-correctness, dependency, and direct-replacement constraint from the source Issue; do not add compatibility shims unless a current runtime consumer proves necessity.

## Plan

Spec: `.agents/spec-docs/done/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md`

- [x] S1 · TC-12, TC-16, TC-22 — `agent-interface-execution`: `'tool-invocation'` in `TBackgroundTaskKind` + `IToolInvocationBackgroundTaskRequest`; `agent-session`: `TASK_KINDS` member (`Contained — DATA-010.`) with a codec round-trip test; DATA-010 Plan line
- [x] S1 · TC-03, TC-04, TC-05, TC-06, TC-07, TC-08, TC-20 — `agent-executor`: `ToolInvocationBackgroundTaskRunner` with its adopter port; runner-declared `admission: 'already-running'` honoured by `spawn` (never queued, no slot, cancel reaches abort); helpers' state projection
- [x] S1 · TC-17 — `agent-executor`: register the runner in `createDefaultBackgroundTaskRunners()`
- [x] S2 · TC-18 — `agent-mcp`: `IMCPTimeouts.toolCallMs`, honoured by `callTool`; `perCallMs` unchanged; composition sets it from `mcp.callTimeoutMs`
- [x] S3 · TC-01, TC-02, TC-04, TC-09, TC-21, TC-23 — `agent-framework`: `buildToolCallHandoff` beside `buildBackgroundProcessTool` (threshold race, single request, commit flag, unlink after a successful `spawn`, placeholder result in `data`, provenance + informational `maxRuntimeMs`, declared spawn-refusal continuation with token release)
- [x] S3 · TC-10, TC-24 — `agent-framework`: wrap by replacement in the session-local list; `createSubagentSession` unwraps for subagents and forks; `scriptedSession()` functional test + `functional-coverage-manifest.json` row
- [x] S3 · TC-12 — `agent-framework`: tracker and `/tasks` render the kind
- [x] S3 · TC-11, TC-18, TC-25 — `agent-cli`: read `mcp.autoBackgroundMs` / `mcp.callTimeoutMs` beside `mcpServers`, set `toolCallMs` from `mcp.callTimeoutMs`, pass `toolCallHandoff` for interactive and serve, omit it for print with one diagnostic
- [x] TC-13 — `agent-core` untouched; `agent-mcp` on `agent-core` only; no wrapper code in `agent-cli`
- [x] TC-14 — `packages/agent-cli/examples/verify-mcp-background.ts` behind `pnpm scenario:verify:mcp-background`
- [x] TC-15, TC-19 — six packages' tests, build, affected scans; SPEC/README layers name the kind and the keys

## Test Plan

Fake-clock unit and integration tests in `agent-framework` (the wrapper) and `agent-executor` (the runner and admission) for the threshold race, the
single-request guarantee, effectively-once delivery (completion, failure, cancellation, shutdown,
restart), composition tests per mode, settings decoding tests, grep/diff assertions for SSOT and
layering, and the process-level scenario runner. Each criterion's exact command is in the spec; the
recorded outputs land in the spec's Evidence Log at completion.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

**Executability probe:** `pnpm scenario:verify` in `packages/agent-cli` (`pnpm exec tsx --conditions=source examples/verify-session-event-delivery.ts`) is the package's existing example runner; the new script follows the same shape and is invoked the same way, under a temporary `HOME`. `pnpm exec tsx --version` → `tsx v4.23.1` in this environment.

### Scenario 1: a long MCP call is handed to a background task and its completion is notified once

- Executability: agent-executable
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=public-sdk-example
- Prerequisites: Node.js and pnpm are installed and `pnpm install` has completed; `@robota-sdk/agent-core`, `@robota-sdk/agent-mcp`, `@robota-sdk/agent-interface-execution` and `@robota-sdk/agent-executor` are built; run from `packages/agent-cli`; the example starts its own mock Streamable HTTP server whose `slow` tool answers after 300 ms, sets `mcp.autoBackgroundMs` to 100 and `mcp.callTimeoutMs` to 5000 in a temporary `HOME`, and needs no network or credentials
- Command: `pnpm exec tsx examples/verify-mcp-background.ts`
- Observable type: sdk-result
- Observable rationale: source=public-sdk-return
- Expected observable: result=handoff=background-task; taskId=<id>; completion=notified-once; status=completed
- Cleanup: the example shuts the manager and the mock server down and removes its temporary `HOME` before exiting; it leaves no files, processes or connections.
- Evidence: pending implementation — recorded at DONE-GATE-STAGE-2 with the command, its exit code and the single printed `result=` line, plus the durable runner path `packages/agent-cli/examples/verify-mcp-background.ts`.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-22

**Status upgrade:** scenario drafted → scenario written

- DONE-GATE-STAGE-1 — ordering: N/A, this gate has no prior gate (`gate-catalogue.md` § Prior-gate
  map: "DONE-GATE-STAGE-1 has no prior gate"), so no prior-gate PASS is owed and none was looked for.
  Input state verified independently for this run: the Task carries `## User Execution Test Scenarios`
  with the author verdict `SCENARIO DRAFTED: automatable | 1`, and `scenarioEntries(<section>)` returns
  exactly one entry, `Scenario 1: a long MCP call is handed to a background task and its completion is notified once`,
  so the outcome and the count agree with what is written. `grep -c DONE-GATE-STAGE-1` on the Task
  returned `0` before this entry, so this is a first verdict, not a re-judgement. Judged at
  HEAD `a63fe09f8` on branch `feat/mcp-004-background-mcp-calls` (HEAD equals
  `origin/integration/agreement-014@a63fe09f8` — no topic commit exists yet), document blob
  `e2f65370f5ab8cf0cff0efc8c00e66ff3aff61d5` (modified) — the blob hashed before this entry was
  appended. `git status --porcelain` lists exactly two paths, both planning artifacts: this Task
  (modified) and the paired spec `.agents/spec-docs/todo/MCP-004-…md` (untracked);
  `git status --porcelain -- packages/` is empty and `packages/agent-cli/examples/` holds only
  `scenarios/`, `session-event-delivery-project-access.ts`, `verify-personal-usage.ts` and
  `verify-session-event-delivery.ts`, so no work this gate precedes has run. Contextual facts checked
  and not inputs this gate reads: the Task frontmatter is `status: todo`; the paired spec is
  `status: approved` with two `[GATE-APPROVAL] — ✅ PASS | 2026-09-22` entries and a later
  `[GATE-IMPLEMENT] — ❌ FAIL | 2026-09-22` (two stray Task paths in the worktree at that time, since
  gone); the spec's mirrored Scenario 1 differs from this Task's in two details (the spec's `Evidence:`
  line stops at "the single printed `result=` line" where the Task's adds "plus the durable runner
  path …", and the spec's `Cleanup:` line has no trailing period) — a mirror drift the paired spec's
  gates own, not one of this gate's four criteria.
- DONE-GATE-STAGE-1 — every scenario is written with exact commands or UI steps, prerequisites, an
  expected observable result, and an evidence field: PASS. Scenario 1 carries `Executability`,
  `Product surface`, `Surface rationale`, `Prerequisites`, `Command`, `Observable type`,
  `Observable rationale`, `Expected observable`, `Cleanup` and `Evidence`, each exactly once and
  non-empty; `browser steps`/`UI steps`/`product state path` and the manual barrier trio are correctly
  absent for an automatable SDK scenario. Verified by running the repository's own validators rather
  than by reading: `validateApplicableScenarioSection(<section>)`
  (`scripts/harness/user-execution-scenario-contract.mjs`) returns `{ ok: true, scenarios: [Scenario 1] }`
  and `scenarioContract(<Scenario 1 body>, 'automatable')` returns a full binding with every field
  resolved. The command is exact (`pnpm exec tsx examples/verify-mcp-background.ts`, working directory
  fixed by "run from `packages/agent-cli`" in the prerequisites). The expected observable
  `result=handoff=background-task; taskId=<id>; completion=notified-once; status=completed` carries
  three deterministic assertions (the handoff kind, the single notification, the terminal status) and
  one runtime-minted value, `taskId=<id>`; the angle-bracket form for a value known only at run time is
  the form already accepted in completed records (`SCREEN-2002`'s
  `Skipped "broken.json" — <its diagnostic>`), and Stage 2 must record the concrete id the run printed
  in its place. `Evidence: pending implementation — recorded at DONE-GATE-STAGE-2 with the command,
its exit code and the single printed result= line, plus the durable runner path
packages/agent-cli/examples/verify-mcp-background.ts` is a present, forward-bound field naming the
  durable artifact Stage 2 will cite. The named runner and the `scenario:verify:mcp-background` script
  do not exist yet (`ls packages/agent-cli/examples` above; `packages/agent-cli/package.json` scripts
  hold only `scenario:verify` and `scenario:record`), and that is correct here, not a defect: the Task's
  own `## Plan` item TC-14 builds both, which is the `backlog-execution.md` § Scenario Design
  Preference Order route for a fixture "that does not exist yet" ("build that environment as part of
  the backlog"), and MCP-001 and MCP-002 were accepted at Stage 1 in this repository on the same shape
  (`.agents/tasks/completed/MCP-002-…md`, `[DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-22`). The fixture the
  prerequisites lean on exists today: `packages/agent-mcp/src/__tests__/mock-mcp-server.ts` already
  takes `toolCallDelayMs` (line 66), so a `slow` tool answering after 300 ms is a configuration of the
  shipped mock, not a new server.
- DONE-GATE-STAGE-1 — every scenario carries its executability decision: PASS.
  `Executability: agent-executable` is declared, so no `manual-only:` technical reason is owed and the
  barrier trio is correctly absent. The decision is substantiated, not asserted: this guardian re-ran
  the § Executability probe rather than accepting it. From `packages/agent-cli` with `HOME` pointed at
  a fresh `mktemp -d` directory on 2026-09-22: `pnpm exec tsx --version` printed `tsx v4.23.1` (on
  `node v22.14.0`), and `pnpm scenario:verify` exited `0` — both claims the probe makes are true as
  written. The probe's "invoked the same way" is imprecise in one respect the guardian checked
  separately: `scenario:verify` passes `--conditions=source`, which is not a canonical flag, while
  Scenario 1's command is flag-free; so `pnpm exec tsx examples/verify-session-event-delivery.ts` was
  run flag-free from the same directory and the same `HOME`, and it also exited `0` after importing
  `@robota-sdk/agent-core/testing` and `@robota-sdk/agent-transport` from their built `dist/` — the
  exact resolution the new runner will rely on. (Both runs printed that example's own ARCH-047 darwin
  skip, `{"notApplicable":true,…,"platform":"darwin"}`; that is that script's platform guard, not a
  property of the invocation shape, and Scenario 1 declares no platform condition.) The four `dist/`
  directories the prerequisites name (`agent-core`, `agent-mcp`, `agent-interface-execution`,
  `agent-executor`) exist. The temporary `HOME` held only `.cache` afterwards, so no real `~/.robota`
  was read or written. The `examples/` surface in this package is therefore demonstrably
  agent-executable in the form Scenario 1 authors, and a sibling runner built by this unit inherits
  that executability.
- DONE-GATE-STAGE-1 — the scenario uses a canonical product-surface identity and matching invocation,
  and its observable is not a build/typecheck/lint/test/harness/CI run or an inspection of repository
  text: PASS. Exact binding — surface=`public-sdk-example`;
  surface-rationale=`shipped-interface=public-sdk-example`;
  invocation=`pnpm exec tsx examples/verify-mcp-background.ts`; observable-type=`sdk-result`;
  observable=`result=handoff=background-task; taskId=<id>; completion=notified-once; status=completed`;
  observable-rationale=`source=public-sdk-return`; guardian-observable-verdict=`product-behavior`.
  Mechanically verified, not inferred: `productSurfaceInvocation('public-sdk-example', <command>, null, null)`
  (`scripts/harness/user-execution-scenario-surface.mjs`) returns
  `pnpm exec tsx examples/verify-mcp-background.ts` — a literal path whose first segment is
  `examples`, no chained or substituted command, no expansion, no option before the script path;
  `sdk-result` is the single observable type `allowedObservableTypes` permits for this surface and
  `source=public-sdk-return` is its declared partner; the expected observable matches the `sdk-result`
  shape `/^result=\S.*$/` as one `result=` line. Product-behaviour judgement, which is this guardian's
  own and not the scanner's: the observable is the shipped example program's returned handoff
  outcome — that an in-flight MCP `tools/call` was converted into a background task (the behaviour
  issue #2524 asks for, which no code path provides today), the id that task was given, that its
  completion reached the notification path exactly once, and the task's terminal status — produced by
  the real manager, runner and wrapper driven through the public SDK. None of that is a build,
  typecheck, lint, test run, harness check, CI check, or a reading of repository text. The in-process
  mock Streamable HTTP server is a counterparty fixture the work ships, which `backlog-execution.md`
  § Scenario Design Preference Order endorses ("an in-repo test server in place of a live one makes
  the whole scenario machine-executable"); the code under judgement on this side of the wire is the
  product path. The surface choice is reasoned in the paired spec's § "Why this surface" (the TUI
  handoff is reachable only after a real call crosses the threshold, which no non-interactive product
  verb exposes; print and serve refuse the handoff by design) and matches the accepted precedent
  MCP-001, MCP-2520 and MCP-002 sit on. One observation that is not a defect at this gate: the Plan's
  `agent-cli` line (TC-11/TC-18/TC-25) is what makes the capability reachable from a product surface;
  this scenario proves the SDK path, and the capability-reachability judgement belongs to
  GATE-COMPLETE, not to this gate.
- DONE-GATE-STAGE-1 — a scenario requiring live credentials or an external service states that
  prerequisite explicitly: PASS, satisfied by explicit negation rather than by silence. Prerequisites
  state "needs no network or credentials" and name every environmental condition an executor would
  otherwise discover mid-run: Node.js, pnpm and a completed `pnpm install`; the four built packages;
  the working directory `packages/agent-cli`; the in-process mock Streamable HTTP server the example
  starts itself, its `slow` tool's 300 ms delay, and the two settings it writes
  (`mcp.autoBackgroundMs` 100, `mcp.callTimeoutMs` 5000) into a temporary `HOME` rather than the real
  one. Nothing external can prevent this gate from running in an executor's environment, and the
  scenario says so before it is run.
- DONE-GATE-STAGE-1 — exception clause: N/A, answered rather than skipped. The exception covers a
  scenario that is genuinely impossible to write; the one declared scenario is written in full and
  nothing in this section is recorded as unwritten, so there is nothing to excuse.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: a long MCP call is handed to a background task and its completion is notified once",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "pnpm exec tsx examples/verify-mcp-background.ts",
      "observableType": "sdk-result",
      "observable": "result=handoff=background-task; taskId=<id>; completion=notified-once; status=completed",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Node.js and pnpm are installed and `pnpm install` has completed; `@robota-sdk/agent-core`, `@robota-sdk/agent-mcp`, `@robota-sdk/agent-interface-execution` and `@robota-sdk/agent-executor` are built; run from `packages/agent-cli`; the example starts its own mock Streamable HTTP server whose `slow` tool answers after 300 ms, sets `mcp.autoBackgroundMs` to 100 and `mcp.callTimeoutMs` to 5000 in a temporary `HOME`, and needs no network or credentials",
      "action": {
        "kind": "command",
        "value": "pnpm exec tsx examples/verify-mcp-background.ts"
      },
      "expectedObservable": "result=handoff=background-task; taskId=<id>; completion=notified-once; status=completed",
      "cleanup": "the example shuts the manager and the mock server down and removes its temporary `HOME` before exiting; it leaves no files, processes or connections.",
      "evidence": "pending implementation — recorded at DONE-GATE-STAGE-2 with the command, its exit code and the single printed `result=` line, plus the durable runner path `packages/agent-cli/examples/verify-mcp-background.ts`."
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
