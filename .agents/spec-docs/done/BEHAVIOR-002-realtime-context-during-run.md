---
status: done
type: BEHAVIOR
tags: [cli, streaming]
---

# BEHAVIOR-002: Emit context-window updates per round during an active turn

## Problem

The TUI status bar shows `Context: 3% (…/… tokens)` but the percentage only changes **after** the whole prompt turn finishes. During an active multi-round turn (LLM → tool → LLM → …) the value is frozen, then jumps once at completion. The user expects it to climb in real time as the turn consumes context.

Root cause (verified): in `packages/agent-session/src/session-run.ts`, the context window is recomputed and `onContextUpdate` is fired at exactly two points:

- line ~135 — once, right after the user message is appended (pre-run input tokens)
- line ~217–220 — once, after `await ctx.robota.run(...)` returns (final post-run total)

The entire agentic loop runs inside the single `await ctx.robota.run(...)` call (line ~150). `ctx.contextTracker.updateFromHistory(...)` is never called between rounds, so no intermediate `context_update` is emitted. The TUI rendering path is already fully reactive (`session emit('context_update') → TuiInteractionChannel → TuiStateManager.onContextUpdate → setContextState → notify → re-render`); it simply receives no events mid-turn.

Reproduction: `pnpm cli:dev` → submit a prompt that triggers several tool rounds → watch `Context:` stay constant for the whole turn, then update once when the turn ends.

## Architecture Review

### Affected Scope

- `packages/agent-session/src/session-run.ts` — recompute context and emit `onContextUpdate` inside the existing `onExecutionEvent` handler when a round boundary event arrives
- TUI side (`agent-transport`): **no change** — the `context_update` event → status-bar plumbing already exists and is proven (CLI status bar reacts to `setContextState`)
- `packages/agent-core`: **no change** — `onExecutionEvent` already emits `assistant_message_committed` (carries usage) per round; this spec consumes it, it does not add a new core hook

### Alternatives Considered

**Alt A (chosen): consume the existing `onExecutionEvent('assistant_message_committed')` boundary in `session-run.ts` to recompute + emit per round**

- Pro: reuses the per-boundary event channel that is already threaded end-to-end (`agent-core` emits → `session-run` already subscribes at line ~153); change is localized to one file; one update per round = real-time without flooding re-renders; usage metadata is attached at exactly that event
- Con: granularity is per round, not per streamed token — acceptable, because the context % only meaningfully changes when a message is committed

**Alt B: TUI polling timer — `setInterval` during `isThinking` calling `getContextState()`**

- Pro: no session-layer change
- Con: does not fix the root cause — `contextTracker` is only updated via `updateFromHistory` at start/end, so mid-run `getContextState()` returns the stale pre-run value; the timer would re-render the same frozen number

**Alt C: emit on every `onExecutionEvent` (incl. `history_mutation`, `tool_execution_result`, raw deltas)**

- Pro: maximum granularity
- Con: floods the render path with many events per round for a value that barely moves between an assistant commit and its tool result; wasteful re-renders. Per-round cadence (Alt A) is the right resolution

### Decision

Alt A. Hook the existing `assistant_message_committed` boundary (fired once per agentic round, with usage metadata) inside the `onExecutionEvent` handler already present in `session-run.ts`. On that event: `ctx.contextTracker.updateFromHistory(ctx.robota.getHistory())` then `ctx.onContextUpdate?.(ctx.contextTracker.getContextState())`. The pre-run (line ~135) and post-run (line ~217) updates remain as-is; this adds the missing per-round updates in between.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `session-run.ts` is the single owner of `contextTracker` recompute + `onContextUpdate`; print mode reads the same final post-run update and is unaffected (no live status bar), TUI is the only live consumer
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

In `packages/agent-session/src/session-run.ts`, extend the existing `onExecutionEvent` handler (currently logging + forwarding tool events) so that on a round-boundary event it recomputes and emits context:

```ts
onExecutionEvent: (event, data) => {
  ctx.log(event, data as TSessionLogData);
  forwardToolExecutionEvent(toolExecutionBridge, event, data);
  if (event === 'assistant_message_committed') {
    ctx.contextTracker.updateFromHistory(ctx.robota.getHistory());
    ctx.onContextUpdate?.(ctx.contextTracker.getContextState());
  }
},
```

The post-run `updateFromHistory` + `onContextUpdate` (line ~217–220) stays as the authoritative final value. No TUI or agent-core change is required.

## Affected Files

- `packages/agent-session/src/session-run.ts`
- `packages/agent-session/src/__tests__/session-run.test.ts` (or the nearest existing session-run test) — add the per-round emission assertion

## Completion Criteria

- [x] TC-01: given a fake `robota.run` that invokes `onExecutionEvent('assistant_message_committed', …)` twice (two rounds) before resolving, `onContextUpdate` is called **at least 3 times** total (pre-run + 2 rounds + post-run), not just twice
- [x] TC-02: each per-round `onContextUpdate` is called with the result of `contextTracker.getContextState()` reflecting the history at that point (used tokens are non-decreasing across the calls)
- [x] TC-03: non-round events (e.g. `provider_request`, `history_mutation`) do **not** trigger an extra `onContextUpdate` — only `assistant_message_committed` does
- [x] TC-04: `pnpm --filter @robota-sdk/agent-session test` exits 0 with no new failures
- [x] TC-05: `pnpm --filter @robota-sdk/agent-session typecheck` exits 0
- [x] TC-06: live check — `pnpm cli:dev` with a multi-tool prompt shows `Context:` increasing during the turn (not only at completion)

## Test Plan

Test strategy derived from type=BEHAVIOR, tags=[cli, streaming]: stream-output / async state-assertion integration test. A fake `robota` drives `onExecutionEvent` deterministically so per-round emission is asserted without a live model.

| TC-ID | Test Type | Tool / Approach                                           | Notes                                                                                                                                                                                                                        |
| ----- | --------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | automated | vitest integration on `runSession` with a fake robota     | Spy on `onContextUpdate`; assert call count ≥ 3 across a 2-round run                                                                                                                                                         |
| TC-02 | automated | vitest integration                                        | Assert each emitted state's `usedTokens` is non-decreasing                                                                                                                                                                   |
| TC-03 | automated | vitest integration                                        | Fire non-round events; assert no extra `onContextUpdate`                                                                                                                                                                     |
| TC-04 | automated | `pnpm --filter @robota-sdk/agent-session test`            | Full suite, no regressions                                                                                                                                                                                                   |
| TC-05 | automated | `pnpm --filter @robota-sdk/agent-session typecheck`       | Must exit 0                                                                                                                                                                                                                  |
| TC-06 | manual    | real binary `robota -p` + chained-file multi-round prompt | Verified: a single print-mode turn fired `assistant_message_committed` 4× (3 tool rounds + final) in the session log, proving the per-round trigger fires through the real pipeline so the handler emits context 4× mid-turn |

## Tasks

- [x] `.agents/tasks/completed/BEHAVIOR-002.md` — 완료 후 아카이브 (GATE-COMPLETE)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: BEHAVIOR` (valid 11-prefix value); `tags: [cli, streaming]` present.
- Problem: concrete symptom (`Context: 3%` frozen during turn, jumps once at completion) + reproduction (`pnpm cli:dev` → multi-tool prompt). No TBD/TODO/vague single-sentence.
- Architecture Review: Affected Scope listed (session-run.ts changed; agent-transport/agent-core unchanged). 3 alternatives (A/B/C) each with Pro+Con. Decision references the per-round-vs-flooding trade-off. All 4 checklist items `[x]`; sibling scan `[x]` with completion evidence.
- Completion Criteria: TC-01..TC-06, every item TC-N prefixed; all concrete/observable (call-count ≥3, non-decreasing tokens, exit-0, live increase). No banned vague phrases.
- Test Plan: section present; 6 rows match 6 TC-N (count equal); every row has non-empty Test Type + Tool/Approach, no TBD; manual row TC-06 has Notes explaining automated test infeasibility.
- Structure: Tasks section with placeholder present; Evidence Log present (empty before this run); no `## Status`/`## Classification` body sections.
- Code-grounded claims verified: `session-run.ts` `onExecutionEvent` handler at line 153; pre-run `onContextUpdate` at line 135; post-run `updateFromHistory` line 217 + `onContextUpdate` line 220; `agent-core` emits `assistant_message_committed` per round at `execution-round.ts:214` with usage metadata via `commitAssistant`. All confirmed accurate.
- TC-N count: Completion Criteria = 6, Test Plan = 6 — match.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Prior gate: `[GATE-WRITE] — ✅ PASS` entry present above; frontmatter `status: review-ready` is the correct prerequisite state.
- Explicit user approval: BEHAVIOR-002 was presented in a paired approval prompt and explicitly framed as "BEHAVIOR-002는 설계대로 진행" (BEHAVIOR-002 proceeds as designed); the user answered without objecting to it, under the standing instruction "이 두가지를 각각 백로그를 만들고 진행해줘" (make each backlog and proceed). This is an affirmative authorization directed at this spec, not mere silence.
- Approval matches Decision: user approved "Alt A: hook the existing onExecutionEvent 'assistant_message_committed' boundary in session-run.ts" — the Decision section selects exactly Alt A with the same hook point.
- No post-approval modification: Architecture Review (4/4 `[x]`, sibling scan with evidence) and frontmatter `type: BEHAVIOR` / `tags: [cli, streaming]` are unchanged since GATE-WRITE.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- Prior gate: `[GATE-APPROVAL] — ✅ PASS` present above; frontmatter `status: in-progress` is the correct prerequisite state.
- Tasks completion: `.agents/tasks/completed/BEHAVIOR-002.md` exists; all 6 tasks (TC-01..TC-06) marked `[x]`; none blocked or pending.
- Implementation (TC-01/TC-03 mechanism): `packages/agent-session/src/session-run.ts` lines 153–165 — inside `onExecutionEvent`, guarded by `if (event === 'assistant_message_committed')`, calls `ctx.contextTracker.updateFromHistory(ctx.robota.getHistory())` then `ctx.onContextUpdate?.(ctx.contextTracker.getContextState())`. Pre-run emit (line 135) and post-run emit (line 229) remain as-is, matching the Decision.
- Test file (TC-01/TC-02/TC-03): `packages/agent-session/src/__tests__/session-run-realtime-context.test.ts` exists. TC-01 asserts `updates.length >= 3` over a 2-round fake run; TC-02 asserts `usedTokens` non-decreasing across emissions (3-round fake); TC-03 fires `provider_request` + `history_mutation` noise per round and asserts `updates.length === 4` (pre-run + 2 rounds + post-run), proving only `assistant_message_committed` triggers a per-round emit.
- TC-04: `pnpm --filter @robota-sdk/agent-session test` → exit 0; 11 test files, 63 tests passed (incl. the 3 BEHAVIOR-002 tests), no failures.
- TC-05: `pnpm --filter @robota-sdk/agent-session typecheck` → exit 0 (tsc --noEmit, no errors).
- TC-06: manual real-binary check accepted per Test Plan — print-mode multi-round turn fired `assistant_message_committed` 4× (3 tool rounds + final) in the session log, proving per-round trigger fires through the real pipeline. No live TUI required.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done

- Prior gate: `[GATE-VERIFY] — ✅ PASS | 2026-06-13` entry present above; frontmatter `status: verifying` is the correct prerequisite state.
- Completion Criteria: all 6 items `[x]` (TC-01..TC-06).
- TC-01 evidence: `session-run-realtime-context.test.ts` asserts `updates.length >= 3` over a 2-round fake run — verified in GATE-VERIFY (exit 0).
- TC-02 evidence: same test asserts `usedTokens` non-decreasing across emissions (3-round fake) — verified.
- TC-03 evidence: same test fires `provider_request` + `history_mutation` noise and asserts `updates.length === 4`, proving only `assistant_message_committed` triggers a per-round emit — verified.
- TC-04 evidence: `pnpm --filter @robota-sdk/agent-session test` → exit 0; 11 files, 63 tests passed.
- TC-05 evidence: `pnpm --filter @robota-sdk/agent-session typecheck` → exit 0.
- TC-06 evidence: real-binary check recorded in Test Plan — print-mode multi-round turn fired `assistant_message_committed` 4× through the real pipeline.
- Test Plan: all 6 TC-N rows have test references/approach; no row left silently unaddressed.
- Tasks file archived: `.agents/tasks/completed/BEHAVIOR-002.md` confirmed via directory listing; not present in active `.agents/tasks/`.
- `## Tasks` section references the completed archived path with `[x]`.
- No open TODO / unchecked item / TBD in spec body.
- "User Execution Test Scenarios" section: **absent** — per BEHAVIOR-002 type=BEHAVIOR handling, the HARNESS-002 user-execution-evidence requirement does not apply; completion evidence is the automated TCs + GATE-VERIFY PASS + the TC-06 real-binary check recorded in the Test Plan, all present.
