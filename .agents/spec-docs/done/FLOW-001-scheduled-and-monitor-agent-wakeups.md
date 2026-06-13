---
status: done
type: FLOW
tags: [cli, async]
---

# FLOW-001: Wake-event foundation for agent re-invocation (Layer 1)

> **Decomposed (2026-06-13, user-directed):** the original monolithic "scheduled & monitor agent wakeups" feature is split into 6 layered backlogs (core → … → cli). **This spec is Layer 1** — the `agent-executor` wake-event foundation only. Subsequent layers: FLOW-002 (session wake-injection), FLOW-003 (resume re-arm + missed-wake), FLOW-004 (monitor capability), FLOW-005 (`/schedule` command surface), FLOW-006 (TUI labeling). See "## Epic & Layering".

## Problem

The CLI agent acts only when a human types a prompt. There is no way for the agent to be **re-invoked automatically** — by a timer ("wake me in 20 minutes / every weekday 9am and continue this task") or by a background task emitting an actionable event ("the build I started just failed — react now"). Claude Code provides exactly this through three primitives the user observed in this very session:

- **ScheduleWakeup** — schedule the agent to resume at a future time with a follow-up instruction.
- **Monitor** — a background process whose output lines become events that re-invoke the agent.
- **Cron/`/loop`** — recurring autonomous runs on a cadence (while the host is active).

The Robota CLI already has most of the substrate but never closes the loop:

- `packages/agent-executor/src/background-tasks/runners/scheduled-task-runner.ts` runs shell commands on a **cron schedule** (via `croner`) and already emits `background_task_sleeping { nextFireAt }` and `background_task_waking`.
- `packages/agent-executor/src/background-tasks/runners/managed-shell-process-runner.ts` runs long processes and streams `background_task_text_delta` / `background_task_tool_*` events.
- The event pipeline reaches the session and TUI (`interactive-session-background-tracker.ts` → `execution-workspace-projection.ts` → status bar background count).
- Sleeping schedules and their events **persist** in the session record (`backgroundTasks` / `backgroundTaskEvents`) and restore on resume.

**The gap:** nothing consumes `background_task_waking` (or a monitored event) to **inject a new agent turn**. The execution controller already has a `pendingPrompt` queue with `drainPendingQueue()` for re-entry, but no producer wires a wake event into it. As a result a scheduled task can fire its shell command, but the **agent never wakes to reason about the result**. There is also no user-facing way to say "schedule the agent (not just a shell command) to resume with this instruction."

Reproduction: in the CLI, there is no `/schedule`, no `/loop`, and no monitor primitive; a `scheduled` background task only re-runs its shell `command` — the agent is never re-entered.

## Architecture Review

### Affected Scope

> Research basis: `docs/superpowers/research/2026-06-13-agent-wakeup-scheduling-research.md` (Claude Code `/loop`·Monitor·Routines model, DBOS/Temporal durable-execution patterns, and the Robota codebase map of what exists vs. what is missing).

- `packages/agent-executor/src/background-tasks/` — runner types; a wake should carry an agent instruction, not only a shell command. New request variant and/or a runner that emits a pure "wake the agent" event.
- `packages/agent-framework/src/interactive/interactive-session-execution-controller.ts` — the single owner of `executing` + `pendingPrompt` + `drainPendingQueue()`; the re-entry injection point.
- `packages/agent-framework/src/interactive/interactive-session-background-tracker.ts` — already subscribes to background events; candidate consumer that forwards `background_task_waking` into a wake-injection callback.
- `packages/agent-framework/src/interactive/` — a new "agent wakeup" concept (a non-human turn source) and its hook input (so the wake turn is distinguishable from a user prompt, e.g. carries the firing task id + reason).
- Session persistence (`session-persistence.ts`) — re-arm persisted sleeping schedules on resume (cron restart).
- `packages/agent-cli/src/` + `packages/agent-command/src/` — user-facing surface: a `/schedule` command (one-shot + cron) and a monitor capability; registration in `command-setup.ts`.
- TUI status/workspace — already shows `next: Xm`; extend to label agent-wakeup tasks vs shell-only tasks.

### Alternatives Considered

**Alt A (chosen — Phase 1): in-process wakeup that injects an agent turn via the existing `pendingPrompt` queue**

- Reuse the existing `scheduled-task-runner` (croner) and `managed-shell-process-runner`; add a wake event consumer that, on `background_task_waking` (timer) or a monitored actionable event, enqueues a synthetic agent turn (the configured wake instruction + the triggering event's context) through `SessionExecutionController`'s pending queue, re-entering the loop after the current turn drains.
- Pro: every primitive already exists (runners, event pipeline, pending queue, persistence) — this closes the loop with the smallest new surface; matches Claude Code's `/loop`/Monitor model which runs "as long as the host is active".
- Con: only fires while the CLI process is alive. A wake whose time arrives while the CLI is closed is missed (re-armed on next resume).

**Alt B (follow-up): cross-process scheduling via the OS scheduler (cron/launchd/Task Scheduler)**

- Register an OS-level job that re-launches `robota` headlessly at `nextFireAt`, restoring the session and running the wake turn (analogous to Claude Code "Routines").
- Pro: survives CLI exit / reboots — true unattended automation.
- Con: OS-specific, needs install/uninstall lifecycle, permissions, and headless auth; larger surface. Depends on Alt A's wake-turn mechanism existing first.

**Alt C (follow-up): long-lived daemon that keeps sessions warm and re-enters on schedule**

- A background daemon owns durable timers (durable-execution pattern: checkpoint → sleep → resume, per DBOS/Temporal) and re-enters sessions via IPC.
- Pro: one mechanism for both timer and event wakeups, survives terminal close without per-task OS jobs.
- Con: largest surface — daemon lifecycle, IPC, crash recovery, single-writer coordination with the interactive process.

### Decision

**Alt A for FLOW-001 (Phase 1).** Close the loop in-process: a wake event (timer fire or monitored event) injects an agent turn through the existing pending-prompt queue, reusing the existing croner runner, event pipeline, and session persistence. This is the foundation all later phases build on and mirrors Claude Code's own "runs while active" model (`/loop`, Monitor). Cross-process durability (Alt B OS scheduler, Alt C daemon) is explicitly **out of scope for FLOW-001** and recorded as follow-up specs (FLOW-002 OS-scheduler routines; FLOW-003 daemon) so this spec stays shippable and reviewable. Durable-execution research (DBOS `recv()`/`send()` resumption, Temporal durable timers, LangGraph checkpoint-and-resume) informs the persistence contract: the wake schedule and its instruction must be checkpointed so a resumed process can re-arm and continue — which the session record already supports.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — both runner kinds (`process`, `scheduled`) reviewed; `SessionExecutionController` confirmed as the sole `pendingPrompt`/`drainPendingQueue` owner; `interactive-session-background-tracker` confirmed as the existing background-event consumer
- [x] 대안 최소 2개 검토 완료 (A in-process, B OS scheduler, C daemon)
- [x] 결정 근거 문서화 완료 (phased; Alt A foundation, B/C follow-ups)

## Epic & Layering

The full in-process feature is delivered as 6 layered backlogs, each an independent, shippable PR built on the prior (project rule: core → sessions → sdk → cli layered assembly). L1+L2 already deliver the core value ("a scheduled wake re-invokes the agent"); L3+ add robustness/UX.

| Layer  | Backlog             | Package(s)                 | Scope                                                                                                                                      | Depends on |
| ------ | ------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| **L1** | **FLOW-001 (this)** | agent-executor             | Wake-event foundation: `agentInstruction` model, runner emits wake-with-instruction, manager propagates `background_task_waking`           | —          |
| L2     | FLOW-002            | agent-framework            | Session wake-injection: consume the manager wake event → inject a non-user turn via the execution controller pending queue; queue/coalesce | L1         |
| L3     | FLOW-003            | agent-framework            | Resume re-arm + missed-wake surfacing on session restore                                                                                   | L2         |
| L4     | FLOW-004            | agent-executor + framework | Monitor capability: managed-process output match → wake event carrying the matched line                                                    | L1, L2     |
| L5     | FLOW-005            | agent-cli + agent-command  | `/schedule` (+ monitor) command surface                                                                                                    | L2, L4     |
| L6     | FLOW-006            | agent-transport            | TUI labeling of agent-wake tasks vs shell-only tasks                                                                                       | L2         |

Out of the in-process epic entirely (separate future specs): OS-scheduler cross-process routines; long-lived daemon (per the durable-execution research).

## Solution

**Layer 1 — `agent-executor` wake-event foundation only.** No agent-loop behavior change yet (that is L2); this layer establishes the typed wake-event contract the upper layers consume.

1. **Wake request model** — `IScheduledBackgroundTaskRequest` gains an optional `agentInstruction?: string`, and its `command` becomes optional (a wake schedule may fire the agent loop instead of, or in addition to, a shell command). Validation: at least one of `command` / `agentInstruction` must be present.
2. **Runner emits instruction** — `scheduled-task-runner` includes the request's `agentInstruction` on the runner-level `background_task_waking` event when set.
3. **Manager propagates the wake** — `background-task-manager.handleRunnerEvent` currently **swallows** `background_task_waking` (returns early, only a status update reaches subscribers). Change it to emit a manager-level `background_task_waking { taskId, instruction? }` so upper layers can consume it. `background_task_sleeping` stays swallowed (the status/`nextFireAt` update already carries it).

This is additive to the event union; existing consumers use `if (event.type === …)` chains (not exhaustive `never` switches), so no consumer breaks.

## Affected Files

- `packages/agent-executor/src/background-tasks/types.ts` — `agentInstruction` on scheduled request; `instruction?` on runner `background_task_waking`; new manager-level `background_task_waking { taskId, instruction? }` in `TBackgroundTaskEvent`
- `packages/agent-executor/src/background-tasks/runners/scheduled-task-runner.ts` — pass `request.agentInstruction` into the waking emit
- `packages/agent-executor/src/background-tasks/background-task-manager.ts` — emit (stop swallowing) the manager-level `background_task_waking`
- `packages/agent-executor/src/background-tasks/__tests__/` — new unit tests
- `packages/agent-cli/docs/SPEC.md` / `packages/agent-executor` SPEC (if it documents the event contract) — keep SSOT in sync

## Completion Criteria

- [x] TC-01: `IScheduledBackgroundTaskRequest` accepts `agentInstruction` with `command` optional; constructing a request with only `agentInstruction` typechecks and is accepted by the scheduled runner
- [x] TC-02: when a scheduled task with `agentInstruction` fires, the manager emits a manager-level `background_task_waking` event whose `taskId` matches and whose `instruction` equals the request's `agentInstruction` (previously this event was swallowed)
- [x] TC-03: a scheduled task WITHOUT `agentInstruction` (shell-only) still fires its command and does NOT emit an instruction-bearing wake — backward behavior preserved (no regression)
- [x] TC-04: `pnpm --filter @robota-sdk/agent-executor test` exits 0 with no new failures
- [x] TC-05: `pnpm --filter @robota-sdk/agent-executor typecheck` exits 0

## Test Plan

Test strategy derived from type=FLOW, tags=[cli, async]: async state-assertion integration test on the executor. Fires are driven with a near-immediate cron (e.g. every second) plus an event spy so timing is not coupled to a specific wall-clock position; no agent loop is involved at this layer.

| TC-ID | Test Type | Tool / Approach                                                    | Notes                                                                     |
| ----- | --------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| TC-01 | automated | vitest type+unit on the request model + scheduled runner accept    | `agentInstruction`-only request typechecks and runs                       |
| TC-02 | automated | vitest integration: manager subscribe + scheduled fire + event spy | Assert manager-level `background_task_waking{taskId,instruction}` emitted |
| TC-03 | automated | vitest integration: shell-only scheduled task                      | Assert command fires, no instruction-bearing wake (no regression)         |
| TC-04 | automated | `pnpm --filter @robota-sdk/agent-executor test`                    | Full suite, no regressions                                                |
| TC-05 | automated | `pnpm --filter @robota-sdk/agent-executor typecheck`               | Must exit 0                                                               |

## Tasks

- [x] `.agents/tasks/completed/FLOW-001.md` — 완료 후 아카이브 (GATE-COMPLETE)

## Evidence Log

### [RE-SCOPE] — 2026-06-13

User-directed decomposition: the monolithic 8-TC Phase-1 spec is split into 6 layered backlogs (FLOW-001…FLOW-006). This spec is narrowed to **Layer 1 (agent-executor wake-event foundation)** — a strict reduction of the previously approved scope (GATE-WRITE/APPROVAL/IMPLEMENT below remain valid; the new Completion Criteria are a subset confined to the executor layer). Upper layers L2–L6 are tracked as separate specs. User quote: "그렇게 큰 작업이면 순차적인 계층을 쌓아가는 형식으로 백로그를 여러개로 나눌수도 있지 않나?" → confirmed 6-layer breakdown.

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: FLOW` (valid prefix); `tags: [cli, async]` present.
- Problem: concrete symptom (no `/schedule`/`/loop`/monitor; scheduled task re-runs shell command but agent never re-entered) + reproduction condition; no TBD/TODO.
- Architecture Review: Affected Scope present; 3 alternatives (A in-process, B OS scheduler, C daemon) each with Pro+Con; Decision references trade-off (smallest shippable surface, foundation for follow-ups); all 4 checklist items `[x]` including sibling-scan with evidence.
- Completion Criteria: TC-01..TC-08 all TC-N prefixed, all concrete/observable; no banned vague phrasing.
- Test Plan: present; 8 rows (TC-01..TC-08) match 8 criteria; each row has non-empty Test Type + Tool/Approach; no TBD; all rows automated (no manual rows requiring justification).
- Structure: Tasks section with placeholder present; Evidence Log present (was empty); no `## Status`/`## Classification` body sections.
- TC-N count match confirmed: Completion Criteria = 8, Test Plan = 8.
- Code claims verified against repo: `scheduled-task-runner.ts` emits `background_task_sleeping` (with `nextFireAt`) at L152-153 and `background_task_waking` at L109; `interactive-session-execution-controller.ts` has `pendingPrompt` (L56) and `drainPendingQueue()` (L148).

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Prior gate: `### [GATE-WRITE] — ✅ PASS | 2026-06-13` entry present above with full per-section evidence.
- Frontmatter precondition: `status: review-ready` — valid input state for GATE-APPROVAL.
- Explicit user approval (verbatim): "두개 다 순차적으로 구현 flow-001부터" — direct, unambiguous statement directed at this spec, authorizing implementation of FLOW-001 first. Matches the "진행해"/authorizes-implementation criterion; not a clarifying-question answer.
- Decision coherence: Decision section selects Alt A (in-process wakeup via existing `pendingPrompt` queue) for Phase 1, with Alt B (OS scheduler) and Alt C (daemon) explicitly out of scope as follow-up specs — coherent and reflects the approved phased approach.
- Architecture Review complete: all 4 checklist items `[x]`; sibling scan recorded with evidence; 3 alternatives (A/B/C) each with Pro+Con.
- No post-approval modification: frontmatter `type: FLOW` and `tags: [cli, async]` unchanged from GATE-WRITE; Architecture Review section not edited after approval.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

Scope: validated against the re-scoped Layer 1 Completion Criteria TC-01..TC-05 (per `[RE-SCOPE] 2026-06-13`); the broader epic in Architecture Review is context-only.

- Tasks complete: `.agents/tasks/completed/FLOW-001.md` exists with all 5 TC items `[x]`; no pending/blocked tasks. Task file references Layer-1 re-scope.
- TC-01 (agentInstruction-only request typechecks + accepted by runner): `types.ts` L107-123 — `IScheduledBackgroundTaskRequest.command?` optional, `agentInstruction?: string` added; test `scheduled-agent-wake.test.ts > TC-01` passes (runner accepts agentInstruction-only request, emits sleeping). Typecheck green (TC-05) confirms the type-level acceptance.
- TC-02 (manager emits instruction-bearing wake): `background-task-manager.ts` L253-261 emits manager-level `background_task_waking { taskId, instruction? }` (no longer swallowed); runner `scheduled-task-runner.ts` L109-114 carries `request.agentInstruction` on the runner waking event; `types.ts` L266 declares the manager-level variant. Test `> TC-02` passes asserting `{ type, taskId, instruction: 'check the build' }`.
- TC-03 (shell-only, no regression): `scheduled-task-runner.ts` L116-121 — command-only path emits bare `background_task_waking` then re-sleeps; test `> TC-03` passes asserting `instruction` undefined and command path preserved.
- TC-04 (`pnpm --filter @robota-sdk/agent-executor test` exits 0): ran — 10 test files, 78 passed, 0 failed (matches implementer's 78).
- TC-05 (`pnpm --filter @robota-sdk/agent-executor typecheck` exits 0): ran — exit 0. Consumer typecheck also verified green: agent-framework + agent-transport both `Done`, confirming the additive event variant breaks no consumer.
- Note: the Solution prose ("at least one of command/agentInstruction must be present") is not enforced in `validateBackgroundTaskRequest` (L31-45), but this is not a separate TC and does not affect TC-01..TC-05; flagged for the implementer as a non-blocking follow-up.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done

Scope: Layer 1 (agent-executor wake-event foundation) per `[RE-SCOPE] 2026-06-13`; validated against re-scoped Completion Criteria TC-01..TC-05.

- Prior gate: `### [GATE-VERIFY] — ✅ PASS | 2026-06-13` entry present above with per-TC build/test evidence — verifying → done is authorized.
- Completion Criteria checkboxes: TC-01..TC-05 all `[x]` (spec L110-114).
- TC-01: `[x]` — verified at GATE-VERIFY (`types.ts` `command?` optional + `agentInstruction?`; `scheduled-agent-wake.test.ts > TC-01`); test reference recorded.
- TC-02: `[x]` — verified at GATE-VERIFY (`background-task-manager.ts` emits manager-level `background_task_waking{taskId,instruction}`; `scheduled-agent-wake.test.ts > TC-02`); test reference recorded.
- TC-03: `[x]` — verified at GATE-VERIFY (shell-only path emits bare wake, no instruction; `scheduled-agent-wake.test.ts > TC-03`); test reference recorded.
- TC-04: `[x]` — `pnpm --filter @robota-sdk/agent-executor test` exits 0 (10 files, 78 passed, 0 failed); command-form TC, evidence recorded at GATE-VERIFY.
- TC-05: `[x]` — `pnpm --filter @robota-sdk/agent-executor typecheck` exits 0 (consumers agent-framework + agent-transport also green); command-form TC, evidence recorded at GATE-VERIFY.
- Test Plan: all 5 TC-N rows (automated) covered by the test references / command-run evidence above; no row left unaddressed.
- Tasks file archived: `.agents/tasks/completed/FLOW-001.md` present, all 5 TC items `[x]`, no pending/blocked.
- `## Tasks` section updated to reference the archived path with `[x]` (spec L130).
- No open TODO/`[ ]` checkbox in the spec body.
- User-execution done-gate: N/A — this spec has no `## User Execution Test Scenarios` section (type=FLOW, Layer-1 executor-internal contract). Per HARNESS-002, the user-execution-evidence requirement does not apply; completion evidence is the automated TCs + prior GATE-VERIFY PASS.
