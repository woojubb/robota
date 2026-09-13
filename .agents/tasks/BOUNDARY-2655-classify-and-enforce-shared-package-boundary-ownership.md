---
title: 'BOUNDARY-2655: Classify and enforce shared package boundary ownership'
issue: https://github.com/woojubb/robota/issues/2655
status: todo
created: 2026-09-12
priority: high
urgency: now
area: workspace build and verification
depends_on: []
---

# BOUNDARY-2655: Classify and enforce shared package boundary ownership

## Objective

Inventory shared code across the repository and verify API ownership, domain neutrality and at least two independent package consumers for retained shared files. Migrate package-specific helpers, fixtures, constants and data to their owners. Gate drift and report affected-scope/full-suite promotion reasons.

Parent: AGREEMENT-2655; canonical umbrella: https://github.com/woojubb/robota/issues/2655.

Source acceptance: [Issue #2490](https://github.com/woojubb/robota/issues/2490), transferred to the umbrella by its [recorded disposition](https://github.com/woojubb/robota/issues/2490#issuecomment-5642818355). Full-population classification and actual migrations remain binding.

## Plan

- [ ] TC-01: Reconcile the complete tracked population, reference coverage, exclusions and reviewed ownership dispositions.
- [ ] TC-02: Validate retained generic shared material against independent consumer evidence and preserve domain-owned public contracts.
- [ ] TC-03: Migrate all classified owner-local material, including recording, hook, session migration and private PTY tooling, preserving behavior.
- [ ] TC-04: Extend the existing reference analysis and reject ownership drift with positive/negative regressions.
- [ ] TC-05: Integrate justified operation/cache inputs and truthful selected/executed/skipped/global-promotion reporting.
- [ ] TC-06: Verify focused and affected scope plus final remote CI, land on origin/develop and reconcile source/parent completion.

## Delivery

Merge into origin/develop after verification and record the delivering commit in the source Issue.

## Progress

2026-09-13: resumed the remaining source Issue #2490 scope after PR #2717 landed. The canonical
draft is `.agents/spec-docs/draft/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md`.
At base `38e87a027c530dbbe11beae9a62bc6732f65ca59`, read-only AST inspection covered 4,186 tracked
code files and identified 38 resolved relative cross-owner references plus 21 dynamic module
expressions. This is partial reference evidence, not full semantic classification. Nash confirmed
the foundational cause is already owned by this Task; Pascal supplied the private testing-package
relocation constraints. Public API versus generic shared-material criteria and the framework
recorder's provider-neutral boundary still require validation before recommendation approval.
No product implementation, complete population classification or gate PASS is claimed.
The draft's Owner Decision Recommendation now specifies the public-SDK classification boundary,
private PTY relocation and the strictly non-published recording-tool composition exception. These
are concrete contract/placement choices, not another request to approve an already-authorized merge.

2026-09-13: the user explicitly approved all three design recommendations with `모듀 승인함`.
Approval is recorded in the canonical draft's Owner Approval section. Public-SDK classification,
private PTY relocation/removal and the strictly non-published framework recording composition
exception no longer require another owner decision. Independent design validation and delivery
verification remain outstanding; this approval alone does not complete a Plan item or gate.

## Test Plan

2026-09-13: Hume independently endorsed the latest recommendation, including the single reference
analysis/graph route, shared typed selection/cache evidence and approved non-published recorder
placement. `REVIEW VERDICT: ENDORSE`. No additional design findings were reported. This is design
validation, not completed population classification, implementation or CI evidence.

Focused positive/negative regressions plus actual execution at the owning boundary. Verify every
requirement in Objective and the source Issue before marking this Task complete.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 6`

**Subject:** `.agents/tasks/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md`

**Applicability:** Moving the executable hook examples and documented session-history migration
changes commands that users can invoke. The framework's existing offline goal replay supplies an
observable for preserving its owned cassette scenario. This is not a blanket N/A for ownership work.

**Surface selection:** Prefer self-contained public SDK examples and ordinary disposable sample
data. Commands below run from the stated package directory; they do not require a live provider,
credentials, HOME rebinding, a test runner, a Git fixture, a clone or a worktree. Package-owned
example paths are literal `examples/...` paths relative to that working directory.

**Invocation probes, not completion evidence (2026-09-13):** `node --version` returned `v22.14.0`;
`pnpm exec tsx --version` returned `tsx v4.23.1`. From the repository root, each of
`node scripts/examples/hook-block-demo.mjs`, `node scripts/examples/hook-json-response-demo.mjs`,
`node scripts/examples/hook-permission-mode-demo.mjs` and
`node scripts/examples/hook-timeout-demo.mjs` returned exit 0. Observed hook results included the
blocking reason, JSON denial, both permission-mode strings, and a timeout error at 1006ms followed
by `hook completed` at 2025ms. These probes used the existing paths and existing build artifacts;
none proves the relocated paths or the completed BOUNDARY implementation.

**Fixture preparation inside this unit:** In addition to moving the four existing examples, propose
two small executable examples owned by the affected packages:
`packages/agent-session/examples/verify-session-history-migration.mjs` and
`packages/agent-framework/examples/verify-goal-cassette-replay.mts`. Their sole work is sample setup,
invocation of the actual migration command or existing public framework testing API, reporting the
observed results, and cleanup. They must not copy the migration algorithm, goal loop or cassette
provider, or introduce a generic harness. These two files and the new migration flag are not yet
implemented or executed; main must include their preparation in this unit before the scenarios are
executed. Missing setup is not a passing scenario or a request to run against real user data.

**Bounded execution limitations:** Scenarios 5 and 6 are drafted setup contracts, not attempted
commands: their owner-local examples do not yet exist, and the safe migration flag is not yet
implemented. Do not mark Stage 2 or relocation verified until actual execution fills the six evidence
fields. PTY relocation and HOME-isolation tests remain engineering verification on the permitted
remote runner; they are not local scenarios, and preserving their behavior does not permit local
HOME overrides. The live recorder and default-home migration paths remain unexecuted by design.

### Scenario 1: Relocated hook blocking example

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: Working directory: `packages/agent-core`. Relocate `hook-block-demo.mjs` to this package's `examples/` and point its import at the owning package output. The current agent-core artifact and a POSIX shell must be available. The destructive-looking `tool_input.command` is inert input data; execute only the example's harmless configured hook that prints a reason and exits 2, never that tool-input string.
- command: `node examples/hook-block-demo.mjs`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=runHooks returns blocked=true and reason="Bash tool blocked: dangerous command detected" Comparison: Capture the actual `runHooks result` JSON and exit 0. The example's later manually assembled `IToolResult` and its PASS prose do not prove PermissionEnforcer or AI delivery behavior.
- cleanup: No scenario files are created; allow the short hook child to exit.
- evidence: pending

### Scenario 2: Relocated JSON hook responses

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: Working directory: `packages/agent-core`. Relocate `hook-json-response-demo.mjs`, correct the owning output import, and use the same current agent-core artifact and local shell. Its three hook commands only print JSON.
- command: `node examples/hook-json-response-demo.mjs`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=stopReason blocks with Security policy violation; PreToolUse returns permissionDecision=deny; systemMessage returns blocked=false and stdout="User has elevated permissions today." Comparison: Compare all three actual returned objects printed by the example and require exit 0; do not substitute its summary string for the returned values.
- cleanup: No persistent files or services; hook children exit normally.
- evidence: pending

### Scenario 3: Relocated permission-mode stdin forwarding

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: Working directory: `packages/agent-core`. Relocate `hook-permission-mode-demo.mjs`, correct the owner import, and make Node available on PATH for the child that reads hook JSON from stdin. No user settings are seeded.
- command: `node examples/hook-permission-mode-demo.mjs`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=hook stdout is "default" then "bypassPermissions", with blocked=false for both invocations Comparison: Capture both child stdout values and exit 0. These strings verify forwarding only; the scenario does not change the verifier's own permission posture.
- cleanup: No scenario files; both stdin-reading children exit.
- evidence: pending

### Scenario 4: Relocated timeout example with explicit runtime outcomes

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: Working directory: `packages/agent-core`. Relocate `hook-timeout-demo.mjs`, correct both its owning output import and command-executor source lookup. Use a POSIX shell with `sleep`; no long wait is required.
- command: `node examples/hook-timeout-demo.mjs`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=timeout:1 returns blocked=false with errors containing kind=timeout; timeout:5 returns blocked=false with stdout containing "hook completed" Comparison: Capture both actual result objects, exit 0 and the existing elapsed-time checks (first below 1800ms; second at least 1800ms and below 4000ms). A slow host failure must be reported, not silently retried into a PASS. Reading DEFAULT_TIMEOUT_SECONDS=600 is source inspection, not evidence that a default-duration command executed; the old "exit code 1" description is not the current timeout outcome contract. Preserve and observe the explicit timeout diagnostic.
- cleanup: Let the short sleep children finish; no persistent data is created.
- evidence: pending

### Scenario 5: Session migration on explicitly injected disposable data

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: Working directory: `packages/agent-session`. Move the real command to `scripts/migrate-session-history.mjs` and implement `--sessions-dir <absolute-directory>` before running this example. The example creates one ordinary `mkdtemp` directory under the OS temporary directory, obtains its absolute path and seeds four JSON files: legacy messages (user "hello", assistant "world", fixed valid updatedAt `2026-01-01T00:00:00Z`), existing nonempty history, empty messages, and malformed JSON. Add one non-JSON sentinel. Keep original bytes for comparison. No fixture contains credentials or uses the real sessions directory; no HOME, USERPROFILE or other global-home override is permitted.
- command: `node examples/verify-session-history-migration.mjs`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=first migration reports Migrated: 1, Skipped: 3, Total: 4; legacy history has two chat entries; second migration reports Migrated: 0, Skipped: 4, Total: 4 with unchanged bytes Comparison: The example invokes the real owner command with `execFileSync(process.execPath, [absoluteScriptPath, '--sessions-dir', absoluteFixtureDirectory])`, without a shell or environment override. Report captured command stdout plus the parsed migrated JSON: original messages remain, history types/data preserve user "hello" and assistant "world", each entry has a UUID and the fixed updatedAt timestamp. Existing history, empty-message JSON, malformed JSON and the non-JSON sentinel must remain byte-identical. Compare all bytes again after the second invocation. Also invoke the same command with an explicit missing child directory below the fixture root: observe `No sessions directory found.` and no directory creation. Do not execute the default path, even with `--help`: the old command ignores arguments and would discover the actual home directory. Emit a compact result containing the actual counts and entry values; assertion failure exits nonzero, but exit status alone is not the user evidence.
- cleanup: In `finally`, remove only the exact ordinary temporary directory created by this example; never derive a cleanup target from HOME, a workspace root or an unvalidated command argument.
- evidence: pending

### Scenario 6: Existing framework goal cassette replay, without recording

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: Working directory: `packages/agent-framework`. The new owner-local example uses the existing public `@robota-sdk/agent-framework/testing` scriptedSession API and the existing framework-owned `src/testing/__fixtures__/goal-cassette-fixture.ts` constants/objective. Dependencies and the current public package outputs must resolve. Read the existing cassette without modification; use `scriptedSession({ cassette: GOAL_CASSETTE_PATH, bare: true })`, which owns its ordinary temporary workspace and session-log directory. Do not import Vitest configuration, rebind HOME, load a concrete live provider, read keys or use record/toCassette mode.
- command: `pnpm exec tsx examples/verify-goal-cassette-replay.mts`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=goal.status=satisfied; goal.stopReason=satisfied; GOAL.txt contains "done"; tool calls include Bash and report_goal_status Comparison: Execute `runGoal(buildGoalObjective(harness.cwd), { maxIterations: GOAL_MAX_ITERATIONS })` and print the actual status, stopReason, GOAL.txt content and tool names before disposal. Assert the committed cassette bytes are unchanged. The recorder moves to `packages/agent-framework/scripts/record-goal-cassette.mts`, but this offline run proves preserved replay behavior, not successful live recording or the new concrete provider composition. Keep recorder import/dependency wiring verification in engineering evidence; no paid recording or committed cassette regeneration is authorized. The existing replay test remains in framework.
- cleanup: Always `await harness.dispose()` in `finally`; it removes only its owned temporary workspace after shutdown. Do not write to user settings or delete the committed cassette.
- evidence: pending

### [DONE-GATE-STAGE-1] — ❌ FAIL | 2026-09-13

**Status remains:** todo

- DONE-GATE-STAGE-1 — Ordering: PASS. The catalogue declares no predecessor for this Task-only entry gate; the Task remains todo and records scenarios as planned, not executed. This independent guardian did not author the scenarios. The reported unsupported gate.mjs invocation supplies no gate verdict.
- DONE-GATE-STAGE-1 — Executability: PASS. All six scenarios explicitly say agent-executable. Scenarios 5 and 6 require the two bounded owner-local examples and safe directory injection accepted into this work unit; this is preparation-to-build under user-execution-scenario PLAN step 3, not an execution claim or a manual exception.
- DONE-GATE-STAGE-1 — Product observables: PASS semantically. Scenarios 1–4 observe actual hook results, scenario 5 invokes the real migration command and observes migrated disposable session data, and scenario 6 observes the public scriptedSession goal replay. Source constants, unit tests, wiring checks and prior probes are not substituted for these results.
- DONE-GATE-STAGE-1 — Credentials/services: PASS. The scenarios explicitly use local hooks, disposable data and offline cassette replay; live recording, keys and concrete live providers are excluded. No live-service prerequisite is concealed.

**Failed criteria:**

- Every scenario is fully written in the canonical field contract: all six evidence fields are empty, whereas backlog-execution.md requires nonempty single-line fields. A pending marker is sufficient at Stage 1; executed evidence is not required yet.
  **Required action:** The scenario author must record an explicit pending value and preserve the unexecuted state.
- Canonical scenario/checkpoint binding: headings use `Scenario N — ...`, while the existing scenarioEntries owner accepts `Scenario N` or `Scenario N: ...`. The existing read-only validateApplicableScenarioSection call returned `{"ok":false,"error":"applicable scenario section has no Scenario entries"}` and recognized zero entries. Additionally, scenarioContract rejects continuation lines and the undeclared working-directory/comparison labels; the required command context and comparison details must remain preserved in a supported authored form. Consequently an exact doneGateStageOne payload cannot bind these six current scenario bodies.
  **Required action:** The author must reconcile the scenario headings and fields with the existing canonical contract, preserving all setup, working-directory, comparison and safety requirements. Do not manufacture a PASS payload or weaken the parser in this gate invocation.

No authored scenario was changed, no product scenario or test suite was run, and no Git operation, fixture repository, HOME override or status transition was performed. The only diagnostic invoked the existing pure scenario parser against this Task's text. No Stage-2 verdict is issued.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-13

**Status upgrade:** scenario drafted → scenario written

- DONE-GATE-STAGE-1 — Ordering: PASS. This is the same Task-only entry gate with no predecessor in the catalogue. The Task remains todo; the prior FAIL is retained unchanged. This rejudgement covers its named format failures, not a new scenario pipeline or implementation authorization.
- DONE-GATE-STAGE-1 — Every scenario is fully written: PASS, 6/6. Canonical colon headings and single-line fields now bind all six scenarios. Every evidence field explicitly says pending. Working directories, comparison procedures, sample setup and cleanup/safety constraints remain present; no execution evidence was invented.
- DONE-GATE-STAGE-1 — Executability: PASS, 6/6 agent-executable. Carry the prior semantic judgement: scenarios 5 and 6 require accepted owner-local setup within this unit under user-execution-scenario PLAN step 3. Their missing future examples do not claim an executed result.
- DONE-GATE-STAGE-1 — Canonical product surface and observable: PASS, 6/6 public-sdk-example with matching literal example commands, sdk-result and source=public-sdk-return. The exact names, invocations, expectations and guardian-observable-verdict=product-behavior bindings are recorded below. Hook return values, actual disposable-data migration and public scriptedSession goal replay remain the observables; engineering checks are not substitutes.
- DONE-GATE-STAGE-1 — Credentials and external services: PASS. Carry the prior judgement: local/offline operation is explicit, with no live provider, credentials, recording or external service required. No manual exception is used.
- DONE-GATE-STAGE-1 — Scenario 1: Relocated hook blocking example: field completeness PASS; evidence pending; guardian-observable-verdict=product-behavior.
- DONE-GATE-STAGE-1 — Scenario 2: Relocated JSON hook responses: field completeness PASS; evidence pending; guardian-observable-verdict=product-behavior.
- DONE-GATE-STAGE-1 — Scenario 3: Relocated permission-mode stdin forwarding: field completeness PASS; evidence pending; guardian-observable-verdict=product-behavior.
- DONE-GATE-STAGE-1 — Scenario 4: Relocated timeout example with explicit runtime outcomes: field completeness PASS; evidence pending; guardian-observable-verdict=product-behavior.
- DONE-GATE-STAGE-1 — Scenario 5: Session migration on explicitly injected disposable data: field completeness PASS; evidence pending; guardian-observable-verdict=product-behavior.
- DONE-GATE-STAGE-1 — Scenario 6: Existing framework goal cassette replay, without recording: field completeness PASS; evidence pending; guardian-observable-verdict=product-behavior.

**Read-only verification:** Existing validateApplicableScenarioSection returned ok=true with six scenarios; each scenarioContract has evidence=pending, and the existing formatCheckpointEvidence accepted the rule-owned doneGateStageOne v1 payload below. These were pure document/parser operations, not product runs, test suites or Git operations.

**Judged document SHA-256:** `13dc91eae7bbdd48ee2a88365810c08cde4942b19d7bc688042fd79b3d200858` (Task bytes before this entry was appended).

Only this gate evidence is appended. Scenario bodies, the previous FAIL, Task status and Plan checkboxes are unchanged. No Stage-2 result, implementation completion or new owner approval is claimed.

<!-- checkpoint-evidence:v1:start -->
```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: Relocated hook blocking example",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "node examples/hook-block-demo.mjs",
      "observableType": "sdk-result",
      "observable": "result=runHooks returns blocked=true and reason=\"Bash tool blocked: dangerous command detected\" Comparison: Capture the actual `runHooks result` JSON and exit 0. The example's later manually assembled `IToolResult` and its PASS prose do not prove PermissionEnforcer or AI delivery behavior.",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Working directory: `packages/agent-core`. Relocate `hook-block-demo.mjs` to this package's `examples/` and point its import at the owning package output. The current agent-core artifact and a POSIX shell must be available. The destructive-looking `tool_input.command` is inert input data; execute only the example's harmless configured hook that prints a reason and exits 2, never that tool-input string.",
      "action": {
        "kind": "command",
        "value": "node examples/hook-block-demo.mjs"
      },
      "expectedObservable": "result=runHooks returns blocked=true and reason=\"Bash tool blocked: dangerous command detected\" Comparison: Capture the actual `runHooks result` JSON and exit 0. The example's later manually assembled `IToolResult` and its PASS prose do not prove PermissionEnforcer or AI delivery behavior.",
      "cleanup": "No scenario files are created; allow the short hook child to exit.",
      "evidence": "pending"
    },
    {
      "name": "Scenario 2: Relocated JSON hook responses",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "node examples/hook-json-response-demo.mjs",
      "observableType": "sdk-result",
      "observable": "result=stopReason blocks with Security policy violation; PreToolUse returns permissionDecision=deny; systemMessage returns blocked=false and stdout=\"User has elevated permissions today.\" Comparison: Compare all three actual returned objects printed by the example and require exit 0; do not substitute its summary string for the returned values.",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Working directory: `packages/agent-core`. Relocate `hook-json-response-demo.mjs`, correct the owning output import, and use the same current agent-core artifact and local shell. Its three hook commands only print JSON.",
      "action": {
        "kind": "command",
        "value": "node examples/hook-json-response-demo.mjs"
      },
      "expectedObservable": "result=stopReason blocks with Security policy violation; PreToolUse returns permissionDecision=deny; systemMessage returns blocked=false and stdout=\"User has elevated permissions today.\" Comparison: Compare all three actual returned objects printed by the example and require exit 0; do not substitute its summary string for the returned values.",
      "cleanup": "No persistent files or services; hook children exit normally.",
      "evidence": "pending"
    },
    {
      "name": "Scenario 3: Relocated permission-mode stdin forwarding",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "node examples/hook-permission-mode-demo.mjs",
      "observableType": "sdk-result",
      "observable": "result=hook stdout is \"default\" then \"bypassPermissions\", with blocked=false for both invocations Comparison: Capture both child stdout values and exit 0. These strings verify forwarding only; the scenario does not change the verifier's own permission posture.",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Working directory: `packages/agent-core`. Relocate `hook-permission-mode-demo.mjs`, correct the owner import, and make Node available on PATH for the child that reads hook JSON from stdin. No user settings are seeded.",
      "action": {
        "kind": "command",
        "value": "node examples/hook-permission-mode-demo.mjs"
      },
      "expectedObservable": "result=hook stdout is \"default\" then \"bypassPermissions\", with blocked=false for both invocations Comparison: Capture both child stdout values and exit 0. These strings verify forwarding only; the scenario does not change the verifier's own permission posture.",
      "cleanup": "No scenario files; both stdin-reading children exit.",
      "evidence": "pending"
    },
    {
      "name": "Scenario 4: Relocated timeout example with explicit runtime outcomes",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "node examples/hook-timeout-demo.mjs",
      "observableType": "sdk-result",
      "observable": "result=timeout:1 returns blocked=false with errors containing kind=timeout; timeout:5 returns blocked=false with stdout containing \"hook completed\" Comparison: Capture both actual result objects, exit 0 and the existing elapsed-time checks (first below 1800ms; second at least 1800ms and below 4000ms). A slow host failure must be reported, not silently retried into a PASS. Reading DEFAULT_TIMEOUT_SECONDS=600 is source inspection, not evidence that a default-duration command executed; the old \"exit code 1\" description is not the current timeout outcome contract. Preserve and observe the explicit timeout diagnostic.",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Working directory: `packages/agent-core`. Relocate `hook-timeout-demo.mjs`, correct both its owning output import and command-executor source lookup. Use a POSIX shell with `sleep`; no long wait is required.",
      "action": {
        "kind": "command",
        "value": "node examples/hook-timeout-demo.mjs"
      },
      "expectedObservable": "result=timeout:1 returns blocked=false with errors containing kind=timeout; timeout:5 returns blocked=false with stdout containing \"hook completed\" Comparison: Capture both actual result objects, exit 0 and the existing elapsed-time checks (first below 1800ms; second at least 1800ms and below 4000ms). A slow host failure must be reported, not silently retried into a PASS. Reading DEFAULT_TIMEOUT_SECONDS=600 is source inspection, not evidence that a default-duration command executed; the old \"exit code 1\" description is not the current timeout outcome contract. Preserve and observe the explicit timeout diagnostic.",
      "cleanup": "Let the short sleep children finish; no persistent data is created.",
      "evidence": "pending"
    },
    {
      "name": "Scenario 5: Session migration on explicitly injected disposable data",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "node examples/verify-session-history-migration.mjs",
      "observableType": "sdk-result",
      "observable": "result=first migration reports Migrated: 1, Skipped: 3, Total: 4; legacy history has two chat entries; second migration reports Migrated: 0, Skipped: 4, Total: 4 with unchanged bytes Comparison: The example invokes the real owner command with `execFileSync(process.execPath, [absoluteScriptPath, '--sessions-dir', absoluteFixtureDirectory])`, without a shell or environment override. Report captured command stdout plus the parsed migrated JSON: original messages remain, history types/data preserve user \"hello\" and assistant \"world\", each entry has a UUID and the fixed updatedAt timestamp. Existing history, empty-message JSON, malformed JSON and the non-JSON sentinel must remain byte-identical. Compare all bytes again after the second invocation. Also invoke the same command with an explicit missing child directory below the fixture root: observe `No sessions directory found.` and no directory creation. Do not execute the default path, even with `--help`: the old command ignores arguments and would discover the actual home directory. Emit a compact result containing the actual counts and entry values; assertion failure exits nonzero, but exit status alone is not the user evidence.",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Working directory: `packages/agent-session`. Move the real command to `scripts/migrate-session-history.mjs` and implement `--sessions-dir <absolute-directory>` before running this example. The example creates one ordinary `mkdtemp` directory under the OS temporary directory, obtains its absolute path and seeds four JSON files: legacy messages (user \"hello\", assistant \"world\", fixed valid updatedAt `2026-01-01T00:00:00Z`), existing nonempty history, empty messages, and malformed JSON. Add one non-JSON sentinel. Keep original bytes for comparison. No fixture contains credentials or uses the real sessions directory; no HOME, USERPROFILE or other global-home override is permitted.",
      "action": {
        "kind": "command",
        "value": "node examples/verify-session-history-migration.mjs"
      },
      "expectedObservable": "result=first migration reports Migrated: 1, Skipped: 3, Total: 4; legacy history has two chat entries; second migration reports Migrated: 0, Skipped: 4, Total: 4 with unchanged bytes Comparison: The example invokes the real owner command with `execFileSync(process.execPath, [absoluteScriptPath, '--sessions-dir', absoluteFixtureDirectory])`, without a shell or environment override. Report captured command stdout plus the parsed migrated JSON: original messages remain, history types/data preserve user \"hello\" and assistant \"world\", each entry has a UUID and the fixed updatedAt timestamp. Existing history, empty-message JSON, malformed JSON and the non-JSON sentinel must remain byte-identical. Compare all bytes again after the second invocation. Also invoke the same command with an explicit missing child directory below the fixture root: observe `No sessions directory found.` and no directory creation. Do not execute the default path, even with `--help`: the old command ignores arguments and would discover the actual home directory. Emit a compact result containing the actual counts and entry values; assertion failure exits nonzero, but exit status alone is not the user evidence.",
      "cleanup": "In `finally`, remove only the exact ordinary temporary directory created by this example; never derive a cleanup target from HOME, a workspace root or an unvalidated command argument.",
      "evidence": "pending"
    },
    {
      "name": "Scenario 6: Existing framework goal cassette replay, without recording",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "pnpm exec tsx examples/verify-goal-cassette-replay.mts",
      "observableType": "sdk-result",
      "observable": "result=goal.status=satisfied; goal.stopReason=satisfied; GOAL.txt contains \"done\"; tool calls include Bash and report_goal_status Comparison: Execute `runGoal(buildGoalObjective(harness.cwd), { maxIterations: GOAL_MAX_ITERATIONS })` and print the actual status, stopReason, GOAL.txt content and tool names before disposal. Assert the committed cassette bytes are unchanged. The recorder moves to `packages/agent-framework/scripts/record-goal-cassette.mts`, but this offline run proves preserved replay behavior, not successful live recording or the new concrete provider composition. Keep recorder import/dependency wiring verification in engineering evidence; no paid recording or committed cassette regeneration is authorized. The existing replay test remains in framework.",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Working directory: `packages/agent-framework`. The new owner-local example uses the existing public `@robota-sdk/agent-framework/testing` scriptedSession API and the existing framework-owned `src/testing/__fixtures__/goal-cassette-fixture.ts` constants/objective. Dependencies and the current public package outputs must resolve. Read the existing cassette without modification; use `scriptedSession({ cassette: GOAL_CASSETTE_PATH, bare: true })`, which owns its ordinary temporary workspace and session-log directory. Do not import Vitest configuration, rebind HOME, load a concrete live provider, read keys or use record/toCassette mode.",
      "action": {
        "kind": "command",
        "value": "pnpm exec tsx examples/verify-goal-cassette-replay.mts"
      },
      "expectedObservable": "result=goal.status=satisfied; goal.stopReason=satisfied; GOAL.txt contains \"done\"; tool calls include Bash and report_goal_status Comparison: Execute `runGoal(buildGoalObjective(harness.cwd), { maxIterations: GOAL_MAX_ITERATIONS })` and print the actual status, stopReason, GOAL.txt content and tool names before disposal. Assert the committed cassette bytes are unchanged. The recorder moves to `packages/agent-framework/scripts/record-goal-cassette.mts`, but this offline run proves preserved replay behavior, not successful live recording or the new concrete provider composition. Keep recorder import/dependency wiring verification in engineering evidence; no paid recording or committed cassette regeneration is authorized. The existing replay test remains in framework.",
      "cleanup": "Always `await harness.dispose()` in `finally`; it removes only its owned temporary workspace after shutdown. Do not write to user settings or delete the committed cassette.",
      "evidence": "pending"
    }
  ]
}
```
<!-- checkpoint-evidence:v1:end -->
