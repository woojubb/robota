---
status: verifying
type: BEHAVIOR
tags: [hooks, lifecycle, security-gate, agent-core, selfhost]
---

# SELFHOST-009: rich lifecycle hook catalog (named events + PreToolUse security gate)

## Problem

Promotes backlog [SELFHOST-009](../../backlog/SELFHOST-009-hook-catalog.md) toward
[VISION.md](../../../VISION.md). Robota already ships a real, extensible hooks engine — `THookEvent` is a
13-member union (`packages/agent-core/src/hooks/types.ts:6-19`) and **every one of those events actually fires**
today (`runHooks` call-sites in `agent-session`, `agent-framework`, `agent-executor`; verified below). So the gap
vs the strongest exemplar (Claude Code, ~30 hook events + a PreToolUse security gate) is **not the mechanism** —
it is (a) a **documented catalog** of the named lifecycle events that stays true to the code, and (b) a small
number of **genuinely-missing named events** (pre/post model call, permission decision).

Two concrete symptoms:

1. **The catalog is the product surface and it has already drifted.** The only user-facing events table,
   `content/guide/permissions-and-hooks.md:48-58`, lists **8** events — one of which (`Notification`) is a
   **phantom** (not in the `THookEvent` union, no firing call-site) — and **omits 6 real, firing events**
   (`SessionEnd`, `StopFailure`, `SubagentStart`, `SubagentStop`, `WorktreeCreate`, `WorktreeRemove`). There is
   no mechanical floor keeping the documented catalog in sync with the emitted events, so it rots silently.
2. **Genuinely-missing named events.** The backlog wishlist names events the union does **not** have and nothing
   fires: **PreModelCall / PostModelCall** (no `runHooks('…ModelCall', …)` call-site exists) and
   **PermissionDecision** (`PermissionEnforcer.checkPermission` in
   `packages/agent-session/src/permission-enforcer.ts:201-242` returns allow/deny but fires **no** hook on that
   decision). (Note: turn-level _error_ is already covered — `StopFailure` fires on a turn error at
   `packages/agent-session/src/session-run.ts:188`; a distinct per-error event is out of scope.)

This is a **BEHAVIOR** spec: it extends the existing hooks engine — a documented catalog SSOT + a drift-guard scan

- the few missing named events + a first-class PreToolUse security gate — with **no new tier and no parallel hook
  system**.

## Prior Art Research

Claude Code — a fixed catalog of ~30 named lifecycle hook events (PreToolUse, PostToolUse, UserPromptSubmit,
SessionStart/End, Stop, SubagentStart/Stop, PreCompact, Notification, …) with a **PreToolUse security gate**
that can deny a tool via exit-code-2/`permissionDecision: "deny"` (<https://code.claude.com/docs/>). Microsoft
Agent Framework — middleware/filters that wrap agent/function invocation and can short-circuit
(<https://learn.microsoft.com/en-us/agent-framework/overview/>). CrewAI — task/step/tool callbacks fired at
lifecycle points (<https://docs.crewai.com/>). **Common shape:** a documented, fixed set of named lifecycle
events users register handlers on, with a pre-tool gate that can veto the call. **Robota constraint / delta:**
Robota already implements this shape — an extensible `THookEvent` union + `runHooks` strategy engine + the
exit-code-2 → `blocked` PreToolUse denial (`hook-runner.ts:136-142`, `tool-hook-helpers.ts:runPreToolHook`). So
the delta over the exemplar is **not** a new engine but: (1) a **catalog SSOT** that a scan keeps true to the
emitted events, (2) three missing named events wired onto the **same** `runHooks` path, (3) documenting the
existing PreToolUse block path as a first-class security gate. This mirrors the deliberate hooks/permissions
split SELFHOST-005 relies on — mechanism in `agent-core` (`runHooks`, the single `exitCode:2 → blocked`
contract), turn-blocking enforcement in the turn owner `agent-session`
(`session-run.ts` → `PermissionEnforcer` → `tool-hook-helpers.ts` `runPreToolHook`), consumer registration in
`agent-framework`. agent-core's own plugin hooks are void-returning + error-swallowed, so any _gating_ event must
ride the `agent-session` enforcement path, never core plugin hooks.

## Architecture Review

### Affected Scope

- **`agent-core` (hooks)**: extend the existing `THookEvent` union in `hooks/types.ts` with the three missing
  named events (`PreModelCall`, `PostModelCall`, `PermissionDecision`) and their `IHookInput` fields. **No new
  runner, no new executor type, no second dispatch path** — `runHooks(config, event, input, executors?)` already
  dispatches any union member.
- **`agent-session`** (turn owner): fire the three new events at points the turn owner **already observes**, each
  reusing `runHooks` on the already-threaded `hookTypeExecutors` path: `PermissionDecision` in
  `PermissionEnforcer` right after `evaluatePermission` (`permission-enforcer.ts:201-242`); `PreModelCall` /
  `PostModelCall` mapped from the provider-call execution events the turn owner already receives via
  `onExecutionEvent` (`session-run.ts:161-173`) — `provider_request` (emitted as the request goes out,
  `execution-round-streaming.ts:69`) → `PreModelCall`, and `provider_response_normalized` (the **single canonical
  source**, `execution-round-streaming.ts:108`; NOT also `provider_response_raw`, which would double-fire per round) →
  `PostModelCall`. (Correction: **not** `assistant_message_committed`, which fires only after the model has
  already responded — wrong boundary for a "pre" event.) These are **informational-only** notifications: the
  `onExecutionEvent` callback is void and un-awaited by agent-core, so a `runHooks` call fired from it is
  fire-and-forget and cannot block or mutate `provider.chat()` (see Solution §2). The **PreToolUse security gate is unchanged** — it already blocks via
  `runPreToolHook` → `blocked` → denial `IToolResult` (`tool-hook-helpers.ts:58-80`,
  `permission-enforcer.ts:116-124`); this spec documents + tests it, it does not re-wire it.
- **catalog SSOT doc** (`packages/agent-core/docs/HOOK-CATALOG.md`, new): the single documented catalog of every
  named event — timing, fire-site, input fields, and blocking semantics. `content/guide/permissions-and-hooks.md`
  is corrected to reference it (drops the phantom `Notification`, adds the 6 omitted events).
- **`scripts/harness` (drift-guard, new floor)**: `scan-hook-catalog.mjs` compares the documented catalog to the
  code — the `THookEvent` union **and** the event literals actually passed to `runHooks` — and FAILs on any
  drift. Registered in `run-all-scans.mjs`.

### Alternatives Considered

1. **Extend the existing `THookEvent` union + `runHooks`, fire new events from the turn owner, and back the
   documented catalog with a drift-guard scan (CHOSEN).**
   - ✅ Reuses the EXISTING, proven engine and the single `exitCode:2 → blocked` contract. The new events ride the
     already-threaded `hookTypeExecutors` path (`session-run.ts` → `PermissionEnforcer` → `runPreToolHook` →
     `runHooks`), so there is **zero new dispatch machinery and no second block-decision mechanism** — identical
     to the placement SELFHOST-005 adopted for the guardrail executor. `PermissionDecision`,
     `PreModelCall`/`PostModelCall` fire from points the turn owner already observes (post-`evaluatePermission`;
     the `onExecutionEvent` provider-call events `provider_request` / `provider_response_normalized`), so no new
     threading into agent-core's internal run loop. All three are **informational-only** (the `onExecutionEvent`
     callback is void/un-awaited, so a hook fired from it cannot gate `provider.chat()`); the sole _blocking_
     event remains the existing `PreToolUse` gate. The "documented catalog" claim is enforced by a mechanical
     scan (doc ↔ union ↔ firing call-sites), not prose.
   - ❌ The catalog SSOT + scan add a doc/scan pair to maintain — but that pair is precisely the mechanical floor
     enforcement-architecture requires for a "documented catalog" guardian, so it is load-bearing, not overhead.
2. **Fire `PreModelCall`/`PostModelCall` deep inside `agent-core`'s `robota.run()` execution loop (around each
   `provider.chat()`).**
   - ✅ Reads as the "truest" model-call boundary, closest to the provider invocation.
   - ❌ **Correctness/layer:** it requires threading `hooks` + `hookTypeExecutors` into agent-core's internal
     execution loop (new plumbing that does not exist there), and agent-core's own plugin hooks are
     void-returning + error-swallowed, so nothing fired there could ever _gate_. The turn owner already observes
     the identical provider-call boundary via `onExecutionEvent` (`provider_request` /
     `provider_response_normalized`) with hooks + executors in scope, reaching it with **no** new threading. (This
     placement would not restore gating either: `onExecutionEvent` is void/un-awaited, so `PreModelCall`/
     `PostModelCall` are informational-only in _both_ layers.) REJECTED (wrong layer, needless plumbing).
3. **Introduce a separate "lifecycle event catalog" system (a new registry/emitter parallel to `runHooks`) as the
   product surface.**
   - ✅ A purpose-built catalog subsystem reads cleanly in isolation.
   - ❌ It is a **second, parallel hook tier** — exactly what enforcement-architecture forbids ("Do NOT add
     orchestration tiers") and what SELFHOST-005 rejected (two independently-ordered block mechanisms on one
     turn). A user hooking a "catalog event" vs a `THooksConfig` event would face two systems with no defined
     precedence. REJECTED (parallel system).
4. **Ship the catalog as prose/doc only, without a drift-guard scan.**
   - ✅ Cheapest; no scan to write.
   - ❌ **This is the exact failure the Problem documents** — the current events table already drifted (phantom
     `Notification`, 6 omitted events) precisely because no mechanical floor holds it to the code. A prose-only
     catalog "buys nothing" (enforcement-architecture). REJECTED.

### Decision

Adopt (1): **extend the existing hooks engine, do not parallel it.** Add `PreModelCall`, `PostModelCall`,
`PermissionDecision` to the `THookEvent` union + `IHookInput` in `agent-core`, and fire each from the turn owner
(`agent-session`) at a point it already observes, reusing `runHooks` on the already-threaded `hookTypeExecutors`
path — **no new runner, no new executor type, no second block mechanism, no new tier.** The PreToolUse security
gate is the **existing** `runPreToolHook` → `blocked` → denial path made first-class by documentation + a
functional block test; it is not re-wired and gains no second enforcement point (consistent with SELFHOST-005,
which registers its guardrail executor under this same PreToolUse path). Publish the catalog SSOT
(`packages/agent-core/docs/HOOK-CATALOG.md`) enumerating every named event and its blocking semantics, correct the
drifted guide table, and back the "documented catalog" claim with a mechanical **`scan-hook-catalog.mjs`** floor
(doc ↔ `THookEvent` union ↔ `runHooks` firing call-sites) registered in `run-all-scans.mjs`. Consumer registration
of hook definitions stays in `agent-framework`; policies stay in the consumer.

### Validated Recommendation

- **Reachability:** the new events ride the already-threaded `hookTypeExecutors` path
  (`session-run.ts:98/246`, `permission-enforcer.ts:116-124`, `tool-hook-helpers.ts:58-99`), so a fired event
  and — for the PreToolUse gate — a `blocked` result reach exactly the same denial `runPreToolHook`/
  `PermissionEnforcer` already return. Verified against `hook-runner.ts` (`runHooks(…, executors?)`,
  `IRunHooksResult.blocked`, `exitCode:2 → blocked` at lines 95-142). Firing `PreModelCall`/`PostModelCall` from
  the turn owner's `onExecutionEvent` provider-call events — `provider_request` (before `provider.chat()` returns,
  `execution-round-streaming.ts:69`) → `PreModelCall`; `provider_response_normalized` (single canonical source,
  `:108`; NOT also `provider_response_raw`) → `PostModelCall` — is reachable with hooks +
  executors already in `IRunContext` (`session-run.ts:47-48`); a deep agent-core-loop placement is NOT reachable
  without new threading (Alt 2). These two events plus `PermissionDecision` are **informational-only**: because
  `onExecutionEvent` is a void, un-awaited notification callback, the `runHooks` call fired from it is
  fire-and-forget and **cannot** block or mutate `provider.chat()` — unlike the blocking `PreToolUse` gate.
- **Capability preservation:** all 13 existing events keep firing unchanged; the PreToolUse block contract and
  SELFHOST-005's guardrail-executor-under-PreToolUse are untouched and reused.
- **Adversarial:** primary risk = the catalog silently drifting from the code again → prevented by
  `scan-hook-catalog.mjs` (a FAIL on any doc↔union↔call-site mismatch; it would flag today's phantom
  `Notification` + 6 omissions). Secondary risk = a second parallel hook tier / second block point → prevented by
  reusing the single `THookEvent`/`runHooks`/`blocked` path (Alts 3 and 2 rejected; TC-05 asserts single path).

### Architecture Review Checklist

- [x] 영향 패키지/레이어: agent-core hooks (union + input fields only), agent-session (fire 3 new events at
      already-observed points; PreToolUse gate unchanged), agent-core docs (catalog SSOT), scripts/harness
      (drift-guard scan); agent-framework registration surface unchanged. No package/app domain policy.
- [x] Sibling scan 완료 — reuses the EXISTING `THookEvent`/`runHooks(…, executors?)` engine and the single
      `exitCode:2 → blocked` contract; new events fire via the already-threaded `hookTypeExecutors` path exactly
      as SELFHOST-005's guardrail executor does; the drift-guard scan mirrors `scan-orchestration-map.mjs`
      (registry-kept-current) in style + registration. No parallel hook system, no core plugin-hook gating.
- [x] 대안 최소 2개 — 4 considered (extend-union+scan CHOSEN; deep agent-core-loop model-call firing REJECTED on
      layer/plumbing; separate parallel catalog system REJECTED as a second tier; doc-only-no-scan REJECTED as the
      exact drift the Problem documents), each Pro+Con.
- [x] 결정 근거 — single engine + single block contract (extend the union, fire from the turn owner); documented
      catalog held true by a mechanical scan floor (not prose); PreToolUse gate reused not re-wired; scope = the
      delta over the already-firing 13 events. GATE-APPROVAL pending.

## Solution

Extend the existing hooks engine in three coordinated moves, all on the current `runHooks` path:

1. **Missing named events (agent-core).** Add `PreModelCall`, `PostModelCall`, `PermissionDecision` to the
   `THookEvent` union and their carrier fields to `IHookInput` in `packages/agent-core/src/hooks/types.ts`. No
   change to `runHooks`, the executor union, or the block contract.
2. **Fire the new events from the turn owner (agent-session), reusing `runHooks`.** `PermissionDecision` fires in
   `PermissionEnforcer` immediately after `evaluatePermission` (informational; carries the decision).
   `PreModelCall`/`PostModelCall` are mapped from the provider-call execution events `session-run.ts` already
   receives via `onExecutionEvent`: `provider_request` (`execution-round-streaming.ts:69`, emitted as the request
   goes out — before `provider.chat()` returns) → `PreModelCall`; `provider_response_normalized` (the **single
   canonical source**, `execution-round-streaming.ts:108`; the catalog documents ONE fire-site and TC-03 asserts
   single emission — NOT also `provider_response_raw`, which would double-fire per round) →
   `PostModelCall`. (**Not** `assistant_message_committed`, which only fires after the model has responded.) Each
   call reuses the already-threaded `hookTypeExecutors`; none introduces a new block point.

   **These three events are INFORMATIONAL-ONLY, not gating.** `onExecutionEvent` is a void notification callback
   that agent-core does not await, so a `runHooks` call fired from it is fire-and-forget: it **cannot** block or
   mutate `provider.chat()`, and `PermissionDecision` fires _after_ `evaluatePermission` has already decided.
   Their exit codes / `permissionDecision` outputs are ignored. **REQUIRED:** the catalog SSOT
   (`hook-catalog.md`) and the corrected guide MUST mark each of `PreModelCall`, `PostModelCall`, and
   `PermissionDecision` as **non-blocking / informational**, so the "Pre" prefix does not imply a veto they cannot
   deliver. The sole _blocking_ event is the existing `PreToolUse` gate.

   **Naming note (REQUIRED in the catalog).** The new `PermissionDecision` _hook event_ (a member of the
   `THookEvent` union) is distinct from — and must not be conflated with — (a) the existing `TPermissionDecision`
   permissions enum `'auto' | 'approve' | 'deny'` (`packages/agent-core/src/permissions/types.ts:34`), and (b) the
   internal `IRunHooksResult.permissionDecision` field `'allow' | 'deny' | 'ask' | 'defer'`
   (`packages/agent-core/src/hooks/hook-runner.ts:80`, the highest-priority PreToolUse decision). The hook event
   _reports_ a permission decision; it does not extend either existing type.

   The **PreToolUse security gate is the existing path** (`runPreToolHook` → `blocked` → denial
   `IToolResult`) — documented + tested as first-class, not re-wired.

3. **Documented catalog SSOT + drift-guard floor.** Publish `packages/agent-core/docs/HOOK-CATALOG.md` — every
   named event with timing, fire-site (file:function), input fields, and blocking semantics — and correct
   `content/guide/permissions-and-hooks.md` to reference it (drop phantom `Notification`, add the 6 omitted
   events). Add `scripts/harness/scan-hook-catalog.mjs`: it parses the `THookEvent` union, the **firing call-sites**
   across the workspace, and the catalog doc's event table, and FAILs on any of — a union member missing from the
   doc; a documented event that is not a union member (phantom); a documented event with no firing call-site.

   **Firing-call-site detection must resolve indirection — not only string literals at `runHooks(`.** 4 of the 13
   events are dispatched through a _variable_, so their names never appear as a literal first argument to
   `runHooks`: `SubagentStart` / `SubagentStop` fire via `runHooks(hooks, hookEventName, …)` where `hookEventName`
   comes from the `getSubagentHookEvent` mapping table
   (`agent-framework/src/assembly/background-task-hooks.ts:11-24,66`), and `WorktreeCreate` / `WorktreeRemove` fire
   via `runHooks(options.hooks, event, …)` where `event` is a `fireWorktreeHook` parameter
   (`agent-executor/src/subagents/worktree-subagent-runner.ts:65,176,218-239`). A scan that keys only on
   `runHooks('<Literal>'` would treat all 4 as "no firing call-site" and false-FAIL (or, worse, miss their drift).
   The scan therefore resolves a firing event name from **any** of: (a) a string literal passed to `runHooks(`;
   (b) the `hook_event_name:` field literal in the `IHookInput` object at each firing site (every site sets it —
   `hook_event_name: hookEventName` / `hook_event_name: event` included, resolved via the same
   `getSubagentHookEvent` / `fireWorktreeHook` mapping); and (c) the string literals returned by the
   `getSubagentHookEvent` mapping table and passed as the `event` argument at each `fireWorktreeHook` call-site
   (`'WorktreeCreate'` / `'WorktreeRemove'`). This resolves all **13** events, including the 4 variable-dispatched
   ones. Registered in `run-all-scans.mjs`.

## Affected Files

| File                                                                | Change                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-core/src/hooks/types.ts`                            | Add `PreModelCall` / `PostModelCall` / `PermissionDecision` to the `THookEvent` union + their `IHookInput` carrier fields. No change to `runHooks`/executor union.                                                                                                                                                                  |
| `packages/agent-session/src/permission-enforcer.ts`                 | Fire `PermissionDecision` (informational / non-blocking) right after `evaluatePermission` via `runHooks` on the existing `hookTypeExecutors`. PreToolUse block path unchanged.                                                                                                                                                      |
| `packages/agent-session/src/session-run.ts`                         | Fire `PreModelCall` / `PostModelCall` (informational / non-blocking) from the `onExecutionEvent` provider-call events — `provider_request` → `PreModelCall`, `provider_response_normalized` (single canonical source; NOT `provider_response_raw`) → `PostModelCall` — via `runHooks` (hooks + executors already in `IRunContext`). |
| `packages/agent-core/docs/HOOK-CATALOG.md` (new)                    | Catalog SSOT: every named event — timing, fire-site, input fields, blocking semantics.                                                                                                                                                                                                                                              |
| `content/guide/permissions-and-hooks.md`                            | Correct the drifted Events table (drop phantom `Notification`, add `SessionEnd`/`StopFailure`/`SubagentStart`/`SubagentStop`/`WorktreeCreate`/`WorktreeRemove`); link the SSOT.                                                                                                                                                     |
| `scripts/harness/scan-hook-catalog.mjs` (new) + `run-all-scans.mjs` | Drift-guard: FAIL on any doc ↔ `THookEvent` union ↔ firing-call-site mismatch. Firing-site detection resolves variable dispatch (via `hook_event_name:` field literals + the `getSubagentHookEvent`/`fireWorktreeHook` mappings) so all 13 events, incl. the 4 variable-dispatched, are covered. Registered in the scan runner.     |
| `packages/agent-core/docs/SPEC.md`                                  | Update the hook-layer line (event count) and point to the catalog SSOT.                                                                                                                                                                                                                                                             |

## Completion Criteria

- [x] TC-01: **catalog-drift scan floor.** `scan-hook-catalog.mjs` FAILs when the documented catalog and the code
      disagree — a `THookEvent` union member absent from the doc, a documented event absent from the union
      (phantom), or a documented event with no resolved firing call-site; PASSes when they agree. Firing-site
      detection resolves variable dispatch (`hook_event_name:` field literals + the `getSubagentHookEvent` /
      `fireWorktreeHook` mappings), so all 13 events — including the 4 variable-dispatched
      (`SubagentStart`/`SubagentStop`/`WorktreeCreate`/`WorktreeRemove`) — are covered. Proven by two red→green
      fixtures: (a) remove/rename one **literal**-dispatched event in the doc → FAIL; and (b) drift a
      **variable**-dispatched event (e.g. drop `WorktreeCreate` from the doc, or rename it in the
      `getSubagentHookEvent`/`fireWorktreeHook` mapping) → FAIL — proving the scan catches drift behind the
      indirection, not only literal `runHooks('<Event>'` sites. Registered in `run-all-scans.mjs`.
- [x] TC-02: **PreToolUse blocks a tool (functional).** A `PreToolUse` hook returning exit-code-2 (or
      `permissionDecision: "deny"`) causes the tool call to return the denial `IToolResult` via the **existing**
      `runPreToolHook` → `blocked` path — the tool's underlying `execute` never runs (functional test in
      agent-session).
- [x] TC-03: each **new** named event fires at its documented point **exactly once per round** — `PermissionDecision`
      after `evaluatePermission`, `PreModelCall` on `provider_request`, `PostModelCall` on
      `provider_response_normalized` (the SINGLE canonical source — asserting it does NOT also fire on
      `provider_response_raw`, i.e. no double-fire) — each through `runHooks` on the shared
      `hookTypeExecutors` path (unit/functional tests). Also assert all three are **informational-only**: firing
      them does not block/mutate `provider.chat()` or the permission outcome (their `runHooks` result is not
      awaited or consulted for gating), so only `PreToolUse` gates (TC-02).
- [x] TC-04: every **existing** catalogued event still fires at its documented fire-site (regression coverage for
      the 13 current events across agent-session / agent-framework / agent-executor).
- [x] TC-05: **single path, no new tier.** Every catalogued event dispatches through the one `runHooks` engine and
      the one `exitCode:2 → blocked` contract; there is no second, parallel hook/registry system and no second
      block-decision point (assertion/scan; interface-runtime + neutrality guards pass).
- [x] TC-06: no domain hook policy in `packages/` — the catalog + engine stay neutral mechanism (neutrality scan).
- [x] TC-07 (**AGENT-RUN**, per the capability-reachability done-gate): the agent itself runs the real `robota` CLI
      with a user-configured `PreToolUse` hook (in `settings.json`) that DENIES a tool, and observes the tool actually
      blocked in a live run (the tool's effect does not occur / a denial is surfaced) — proving the user-facing hook
      gate is reachable and works end-to-end, not just in a unit test. Evidence saved under `.agents/evals/scenarios/`.
      (Added per the 2026-07-18 agent-run-verification rule; the hook engine is already reachable, so this verifies the
      user-configured gate behavior via a real run.)

## Test Plan

| TC    | Verification                                                                                                                 | Type/Tool                     |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| TC-01 | catalog-drift scan FAIL on doc↔union↔firing-site mismatch; red→green fixtures for a literal- AND a variable-dispatched event | node scan + vitest            |
| TC-02 | PreToolUse deny → denial `IToolResult`, tool `execute` not reached                                                           | vitest functional (session)   |
| TC-03 | new events fire at documented points via `runHooks`; all three informational-only (non-blocking)                             | vitest unit/functional        |
| TC-04 | all 13 existing events still fire at their fire-sites                                                                        | vitest unit (regression)      |
| TC-05 | single `runHooks`/`blocked` path, no second tier                                                                             | assertion + interface-runtime |
| TC-06 | neutrality — no domain hook policy in `packages/`                                                                            | neutrality scan               |
| TC-07 | AGENT-RUN: real `robota` CLI + settings.json `PreToolUse` deny hook → tool blocked in a live run                             | agent-run (`-p`) + evidence   |

## Tasks

[`.agents/tasks/SELFHOST-009.md`](../../tasks/SELFHOST-009.md) — created at GATE-IMPLEMENT; slices S1–S6 (new events → fire-sites → catalog SSOT doc → drift-guard scan → tests → agent-run TC-07) mapped to TC-01..07.

## Evidence Log

- 2026-07-17 — **Draft authored.** Grounded in the actual hooks engine: `runHooks` +
  `IRunHooksResult.blocked` + the `exitCode:2 → blocked` contract (`packages/agent-core/src/hooks/hook-runner.ts:95-142`);
  the `THookEvent` 13-member union + `IHookInput` + `IHookTypeExecutor` (`packages/agent-core/src/hooks/types.ts:6-131`);
  the firing call-sites confirming **all 13 events fire today** — `UserPromptSubmit`/`Stop`/`StopFailure`
  (`agent-session/src/session-run.ts:98,246,188`), `PreToolUse`/`PostToolUse`
  (`agent-session/src/tool-hook-helpers.ts:58-99` via `permission-enforcer.ts:116-185`),
  `SessionStart`/`SessionEnd` (`agent-session/src/session-lifecycle.ts:67,98`), `PreCompact`
  (`agent-session/src/compaction-orchestrator.ts:84`), `PostCompact`
  (`agent-session/src/session-history-ops.ts:85`), `SubagentStart`/`SubagentStop`
  (`agent-framework/src/assembly/background-task-hooks.ts:13-66`), `WorktreeCreate`/`WorktreeRemove`
  (`agent-executor/src/subagents/worktree-subagent-runner.ts:65,176,238`); the genuine gaps —
  `PreModelCall`/`PostModelCall`/`PermissionDecision` have no union member or firing call-site, and
  `PermissionEnforcer.checkPermission` (`permission-enforcer.ts:201-242`) fires no hook on its decision; the
  already-drifted catalog (`content/guide/permissions-and-hooks.md:48-58` — phantom `Notification`, 6 omitted
  events); the enforcement-architecture "guardian needs a mechanical scan floor" rule
  (`.agents/rules/enforcement-architecture.md:24-33`) and the `scan-orchestration-map.mjs` registry-drift pattern
  it mirrors. Consistent with ENDORSED SELFHOST-005 (extend the hooks engine; single `runHooks`/`blocked` path;
  no new tier). **GATE-APPROVAL pending** (independent proposal-reviewer).
- 2026-07-17 — **Iteration 1: RE-REVIEW → REVISE, applied.** Design DIRECTION unchanged (extend `THookEvent` /
  `runHooks`; fire new events from the turn owner; documented catalog + mechanical drift scan; no new tier). Four
  doc/spec fixes from the punch-list, no architecture change: (1) **Corrected the model-call event boundary** —
  `PreModelCall`/`PostModelCall` map from the provider-call execution events, not `assistant_message_committed`
  (which fires only after the model responds): `provider_request` (`execution-round-streaming.ts:69`, emitted as
  the request goes out, before `provider.chat()` returns) → `PreModelCall`, and `provider_response_normalized` /
  `provider_response_raw` (`execution-round-streaming.ts:101-117`, after the response returns) → `PostModelCall`.
  (2) **Marked the 3 new events INFORMATIONAL-ONLY** — `onExecutionEvent` is a void, un-awaited notification
  callback, so a `runHooks` call fired from it is fire-and-forget and cannot block/mutate `provider.chat()`;
  `PreModelCall`/`PostModelCall`/`PermissionDecision` are non-blocking (only `PreToolUse` gates). Made it a
  REQUIRED catalog + guide content item to label each as non-blocking so the "Pre" prefix implies no veto it
  cannot deliver. (3) **Fixed the drift scan to cover all 13 events** — firing-site detection now resolves
  variable dispatch (`SubagentStart`/`SubagentStop` via `getSubagentHookEvent` →
  `runHooks(hooks, hookEventName, …)`; `WorktreeCreate`/`WorktreeRemove` via `fireWorktreeHook`'s `event`
  parameter), keying off the `hook_event_name:` field literals + the mapping tables rather than only string
  literals at `runHooks(`; TC-01 gains a red fixture for a variable-dispatched event. (4) **Added a naming note**
  distinguishing the new `PermissionDecision` hook event from the existing `TPermissionDecision` permissions enum
  (`'auto'|'approve'|'deny'`, `permissions/types.ts:34`) and the internal `IRunHooksResult.permissionDecision`
  field (`'allow'|'deny'|'ask'|'defer'`, `hook-runner.ts:80`). Affected Files / Completion Criteria / Test Plan
  updated for consistency.
- 2026-07-17 — **GATE-APPROVAL iteration 2: ENDORSE** (independent proposal-reviewer). All 4 fixes verified against
  the code: `provider_request` (`execution-round-streaming.ts:69`) fires before `callProviderWithCache`/`provider.chat()`
  → `PreModelCall` (ordering strictly holds); `provider_response_normalized` (`:108`) → `PostModelCall`; the three new
  events are genuinely informational (`TExecutionEventCallback` returns `void`, un-awaited — cannot gate; only
  `PreToolUse`'s `exitCode:2→blocked` gates); the drift scan resolves the variable-dispatched Subagent*/Worktree*
  events via the event-name string literals present in the firing modules (with a red-fixture), covering all 13; the
  `PermissionDecision`/`TPermissionDecision`/`permissionDecision` naming note is accurate. Non-blocking clarity fix
  folded here: **`PostModelCall` is pinned to the single canonical source `provider_response_normalized`** (NOT also
  `provider_response_raw`, which would double-fire per round); the catalog documents one fire-site and TC-03 asserts
  single emission. Direction (extend the one engine, no new tier, mechanical drift floor) intact. **GATE-APPROVAL PASSED.**

### [PRE-IMPLEMENT REFRESH] — 2026-07-19

Picked up for implementation (owner "바로 시작해"). Re-verified the design-gate grounding against current develop (it
holds): `THookEvent` is still the 13-member union; `content/guide/permissions-and-hooks.md` still carries the phantom
`Notification` row + omits the 6 real events; `PreModelCall`/`PostModelCall`/`PermissionDecision` still do not exist.
Added **TC-07 (AGENT-RUN)** to Completion Criteria + Test Plan per the 2026-07-18 capability-reachability /
agent-run-verification rule (owner directive) — the `PreToolUse` security gate is user-facing, so the done-gate now
requires demonstrating it via a real `robota` run, not only a unit test. This is an additive, rule-driven verification
(no design change); the prior GATE-APPROVAL ENDORSE + owner sign-off stand. Proceeding to GATE-IMPLEMENT.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-19

**Status upgrade:** approved → in-progress

- **Prior-gate precondition:** GATE-APPROVAL PASS on record (Evidence Log 2026-07-17 iteration 2 "ENDORSE … GATE-APPROVAL PASSED") + `[PRE-IMPLEMENT REFRESH] 2026-07-19` (grounding re-verified, TC-07 agent-run added); frontmatter `status: approved` and file in `todo/` match the expected GATE-IMPLEMENT input stage. ✅
- **Tasks file created:** `.agents/tasks/SELFHOST-009.md` exists on disk (3492 bytes). ✅
- **Path recorded in spec `## Tasks`:** the section links `.agents/tasks/SELFHOST-009.md` and describes slices S1–S6 mapped to TC-01..07. ✅
- **Tasks map to Completion Criteria:** S1→TC-03 types; S2→TC-03/TC-04; S3→catalog SSOT + guide; S4→TC-01; S5→TC-02/TC-05/TC-06; S6→TC-07 — every TC-01..TC-07 is covered by ≥1 slice. ✅
- **Test Plan present (≥50 chars):** task file carries a `## Test Plan` section enumerating TC-01..TC-07 (unit/functional + AGENT-RUN + regression), well over 50 chars. ✅
- **No implementation commits yet:** `THookEvent` union has no `PreModelCall`/`PostModelCall`/`PermissionDecision` members; `scripts/harness/scan-hook-catalog.mjs` and `packages/agent-core/docs/HOOK-CATALOG.md` do not exist. ✅

### [GATE-VERIFY] — ✅ PASS | 2026-07-19

**Status upgrade:** in-progress → verifying

- **Prior-gate precondition:** GATE-IMPLEMENT PASS on record (Evidence Log 2026-07-19 "approved → in-progress"); frontmatter `status: in-progress` and file in `active/` match the expected GATE-VERIFY input stage. ✅
- **Tasks complete (`.agents/tasks/SELFHOST-009.md`):** all slices S1–S6 (new events → fire-sites → catalog SSOT + guide fix → drift-guard scan → tests → AGENT-RUN TC-07) landed and verified below; none blocked or pending. Implementation confirmed on disk: `THookEvent` union now carries `PreModelCall`/`PostModelCall`/`PermissionDecision` (`packages/agent-core/src/hooks/types.ts:29-31`) + their `IHookInput` carrier fields; `packages/agent-core/docs/HOOK-CATALOG.md` exists (SSOT); `scripts/harness/scan-hook-catalog.mjs` exists and is registered in `run-all-scans.mjs` (`hook-catalog` entry); `content/guide/permissions-and-hooks.md` corrected (no phantom `Notification` event row; `SessionEnd`/`WorktreeCreate`/`PreModelCall` etc. present). ✅
- **Build passes (affected packages):** `pnpm --filter @robota-sdk/agent-core --filter @robota-sdk/agent-session build` → exit 0, both build complete. ✅
- **Tests pass (affected packages):** `pnpm --filter @robota-sdk/agent-core --filter @robota-sdk/agent-session test` → agent-core 880/880 (65 files), agent-session 108/108 (25 files), all pass. ✅
- **Drift-guard scan green:** `node scripts/harness/scan-hook-catalog.mjs` → exit 0 ("hook-catalog scan passed"); `npx vitest run scripts/harness/__tests__/scan-hook-catalog.test.mjs` → 12/12 pass (TC-01 red→green for literal- and variable-dispatched drift). Full `pnpm harness:scan` reported all 57 scans passing (incl. new hook-catalog scan) in the run evidence. ✅
- **AGENT-RUN (TC-07):** `.agents/evals/scenarios/selfhost-009-pretooluse-gate-agent-run.md` records real `robota` CLI runs (anthropic claude-sonnet-4-6): a `settings.json` PreToolUse deny hook blocked the Bash tool ("The command was blocked by a hook."), while a contrast run without the hook executed it — user-facing gate reachable + working end-to-end. (Not re-run per instructions.) ✅
- **All Completion Criteria TC-01..TC-07 are `[x]`.** ✅
