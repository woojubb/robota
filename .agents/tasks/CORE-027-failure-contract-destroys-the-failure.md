---
title: 'CORE-027: the failure contract destroys the failure — a provider error is rendered to prose and re-parsed, a tool crash is reported as `success: true`, and an error whose message contains "abort" is returned as a successful interrupted run'
status: todo
created: 2026-08-02
priority: critical
urgency: now
area: packages/agent-core, packages/agent-session, packages/agent-framework, packages/dag-framework, packages/dag-scheduler, packages/dag-api
depends_on: []
---

# CORE-027: failure is smuggled into a success-shaped value

## Problem

The sharpest silent-wrong-answer in the audit, on the hottest path, with exit-code consequences in
print mode. **Any provider error whose message contains "abort"** — for example "connection aborted
by peer" — is reported as a _successful interrupted run with an empty response_. A tool that throws
is reported as `success: true`. A user denial and a hook block are indistinguishable from success at
the same type.

The result envelopes on these paths cannot express failure, so failure is smuggled into a
success-shaped value — as prose, as a metadata flag, or as a nested JSON string — and every consumer
above has to guess.

The same invariant recurs independently in the DAG subsystem, which shares no code with the agent
stack. That is evidence this is a house pattern, not one bad file.

## Evidence

Observed independently by **L0 (foundation)**, **L1 (runtime)** and **L5 (DAG)**.

- L0 F1 — `packages/agent-core/src/services/execution-round-streaming.ts:119-138` renders a provider
  failure into an assistant chat message with a `providerError: true` metadata flag;
  `execution-service-helpers.ts:214-253` reconstructs it (`:220` reads the flag, `:251-252` returns
  `error: new Error(response)` — the _rendered display string_). Class, `code`, `category`,
  `recoverable`, stack and `cause` are all gone. Worse, cancellation is a bare `Error` with a mutated
  `name` (`execution-round-provider.ts:202-206`, not exported, so no `instanceof` is possible), and
  three sites therefore re-implement a substring test —
  `execution-service.ts:234-239` and `execution-round-streaming.ts:121-125`:
  `error.message.includes('aborted') || error.message.includes('abort')` → `success: true,
interrupted: true`. The workaround is already written one layer up:
  `packages/agent-framework/src/interactive/interactive-session-execution.ts:46-52` copies the same
  heuristic. It also breaks `packages/agent-core/docs/SPEC.md` § _Cancellation Contract (CORE-018)_
  point 4, in both directions.
- L1 #3 — `packages/agent-session/src/permission-enforcer.ts:192-199` returns
  `{ success: true, data: JSON.stringify({ success: false, output: '', error: message }) }` for a
  thrown tool; `permission-types.ts:79-88` `PERMISSION_DENIED_RESULT` does the same for a user denial
  (_"success:true prevents ToolExecutionError"_); `tool-hook-helpers.ts:69-78` for a hook block. Three
  distinct outcomes are indistinguishable from success at `IToolResult`, and `onToolExecution`
  (`permission-enforcer.ts:163-173`) reports `success: true` for a crashed tool. L1 is explicit that
  "never throw" is correct and "encode the failure as success" is not — they are independent
  decisions.
- L5 F10 — `packages/dag-framework/src/create-dag-framework.ts:67-74` `NoopDeadLetterReinject` returns
  `{ ok: true, value: { reinjected: false } }`, wired at `:152`, so
  `dag-api/src/controllers/dag-diagnostics-controller.ts:185` always reports a successful "nothing to
  reinject" — indistinguishable from a genuinely empty DLQ, while the real
  `dag-worker/src/services/dlq-reinject-service.ts:32-48` exists and is tested only against mocks.
- L5 F13 — `dag-scheduler`'s `triggerScheduledBatch` (`scheduler-trigger-service.ts:87-115`) returns
  `{ ok: true, value: { startedRuns, partialError } }` when a later item fails but the error itself
  when the _first_ one does.

The synthesis re-verified, read-only: `permission-enforcer.ts:192-199` is verbatim as quoted.

Same class, ranked separately by the synthesis and filed separately: `ICommandResult` carrying its
failure only as English (rank #21), `ISessionStore.load` collapsing missing and corrupt (residual
bucket), and the plugin-load `catch {}` (rank #15, filed as CORE-029).

The cause in one sentence, from the synthesis: _the result envelopes on these paths cannot express
failure, so failure is smuggled into a success-shaped value — as prose, as a metadata flag, or as a
nested JSON string — and every consumer above has to guess._

## Why this is foundational (or not)

**FOUNDATIONAL** per L0 and L1. The DAG recurrences (L5 F10, F13) are marked **LOCAL** by L5 —
because the correct shape already exists beside them (the real `dlq-reinject-service.ts` exists;
`triggerScheduledBatch` already returns the error correctly for the first item). The synthesis
carries both verdicts rather than collapsing them.

Severity **BLOCKER**: three layers, hottest path, silent, with exit-code consequences in print mode.

## Direction

The invariant the synthesis states for this class (theme T1): _a result type must be able to
represent every outcome its operation can produce, and a failure must survive the boundary with its
class, cause and category intact._

Concretely, from the evidence:

- Cancellation needs a **type**. `createAbortError()` (`execution-round-provider.ts:202-206`) is an
  unexported bare `Error` with a mutated `name`; because no consumer can `instanceof` it, three sites
  plus the framework copy substring-match instead. Exporting a real class removes the substring test
  at all four sites at once.
- The provider failure must not be rendered to prose and re-parsed. `execution-round-streaming.ts:119-138`
  → `execution-service-helpers.ts:214-253` is a round trip through a display string; the class,
  `code`, `category`, `recoverable`, stack and `cause` must survive it.
- `IToolResult` must be able to distinguish thrown / denied / hook-blocked / succeeded. L1's framing
  is the one to keep: **"never throw" is correct and "encode the failure as success" is not — they
  are independent decisions.** The fix is not to start throwing.

Risk named by the synthesis: `agent-core/docs/SPEC.md` § _Cancellation Contract (CORE-018)_ point 4
is already broken **in both directions** by the current behaviour, so the SPEC cannot be used as the
oracle without being re-read; and the framework copy of the heuristic
(`interactive-session-execution.ts:46-52`) will keep the old behaviour alive if only `agent-core` is
fixed.

## Test Plan

- **Required red-first regression:** drive the execution path with a provider error whose message
  contains the substring "abort" but which is **not** a cancellation (e.g. `connection aborted by
peer`) and assert the run is reported as **failed**, not `success: true, interrupted: true`.
  Against current code this must FAIL — `execution-service.ts:234-239` and
  `execution-round-streaming.ts:121-125` classify it by substring.
- Red-first: a tool that throws must not produce `{ success: true, data: '{"success":false,…}' }`
  (`permission-enforcer.ts:192-199`), and `onToolExecution` (`:163-173`) must not report
  `success: true` for it.
- Red-first: a user denial (`permission-types.ts:79-88`) and a hook block
  (`tool-hook-helpers.ts:69-78`) must each be distinguishable from success and from each other at
  `IToolResult`.
- Red-first: a real cancellation must be identifiable by type (`instanceof`), with the substring test
  removed from all four sites including `interactive-session-execution.ts:46-52`.
- DAG side: `NoopDeadLetterReinject` (`create-dag-framework.ts:67-74`) must not be reportable as a
  successful reinject at `dag-diagnostics-controller.ts:185`; `triggerScheduledBatch`
  (`scheduler-trigger-service.ts:87-115`) must report a partial failure the same way whether it is
  the first item or a later one.
- Print-mode exit code: a provider failure must exit non-zero.
- `pnpm harness:verify-like-ci` green.

## Progress

On `fix/core-027-tool-result-can-express-failure`, each red-proved at its own layer:

- **Cancellation is classified from facts, not prose.** `isAbortFailure` (exported, SPEC'd) reads
  the caller's `AbortSignal` and the error's own `name`; the substring sites are gone, including
  the framework copy and — last — the http-request node, whose timeout now reads its own
  controller's signal.
- **`IToolResult` distinguishes thrown / denied / hook-blocked / succeeded** (the earlier session
  commits on this branch), keeping L1's framing: never-throw stays, encode-failure-as-success goes.
- **The provider failure survives by identity.** The streaming catch hands the thrown value out,
  `IExecutionRoundState.providerFailure` carries it, and `buildFinalResult` puts the ORIGINAL
  object in `result.error` — class, code, category, recoverable, stack, cause intact. The prose
  reconstruction remains only for a restored store predating the carried value.
- **DAG: one shape per outcome.** `triggerScheduledBatch` reports every stop as the partial shape
  wherever it stopped; `NoopDeadLetterReinject` reports the absent capability as absent
  (`DAG_VALIDATION_DLQ_REINJECT_UNSUPPORTED`), never as an empty queue.
- **Exit codes:** the execution-level abort-prose regression (`connection aborted by peer` →
  failed, original error by identity) and the headless-transport scenario test (exit 1, failure on
  stderr) both run in the suites.
- SPECs updated where the contracts changed (agent-core result contract, dag-scheduler batch,
  dag-framework reinject).

Remaining before done: the agent-run CLI evidence for the two User Execution scenarios below
(print-mode run against a dropping endpoint; interactive tool-throw vs denial transcript), the
scenario catalog entry, and the PR.

## User Execution Test Scenarios

**Applies.** Exit codes and error text on the CLI's hottest path are user-facing.

- **Prerequisites:** built `robota` CLI. The scenario needs a provider call that fails with a message
  containing "abort" — obtainable by pointing the provider base URL at a local endpoint that accepts
  the connection and then drops it, or by an invalid credential whose error text is checked. This
  fixture does not exist yet and will be built by the work (a small local endpoint under the existing
  test-server pattern).
- **Steps:**
  1. Run the CLI in print mode (`-p`) with a prompt, against a provider configured to fail with a
     connection-aborted error.
  2. Inspect the printed output and `echo $?`.
- **Expected observable result (after the fix):** the printed output names the real provider failure
  (class/category preserved, not a rendered display string), and the exit code is **non-zero**.
- **Expected observable result (before the fix, for contrast):** the run is reported as a successful
  interrupted run with an empty response and a zero exit code.
- **Second scenario:** in an interactive session, invoke a tool that throws, and separately deny a
  tool at the permission prompt. Each must be reported distinctly and neither may be reported as a
  successful tool call.
- **Cleanup:** stop the local failing endpoint.
- **Evidence (fill in after implementation):** command output plus exit code for the print-mode run,
  and the transcript excerpt for the two tool outcomes.
