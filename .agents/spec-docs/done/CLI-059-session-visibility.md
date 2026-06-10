---
status: done
type: OBSERVABILITY
tags: [cli, typescript]
---

# CLI-059: Session visibility — surface memory events in the TUI, bound the session-init polling loop (covers backlog CLI-059/060)

## Problem

1. **Memory events invisible (CLI-059).** The automatic memory system records events
   (`SessionHistoryTracker.recordMemoryEvent`,
   `packages/agent-framework/src/interactive/interactive-session-history-tracker.ts:185`) into an
   internal array, but `IInteractiveSessionEvents`
   (`packages/agent-framework/src/interactive/types.ts:73-90`) defines no memory event, nothing
   emits one, and no TUI code renders memory activity. Users cannot see when the agent stored or
   recalled a memory — conflicting with the transparent-workflow disclosure direction
   (`.agents/specs/transparent-workflow.md`). Reproduce: trigger a memory capture via `/memory`
   APIs (`memory-command-api.ts:122` records an event) — the transcript shows nothing.
2. **Init polling swallows failures forever (CLI-060).** `TuiInteractionChannel.runInitCheck`
   (`packages/agent-transport/src/tui/TuiInteractionChannel.ts:421-439`) polls every 200ms and
   its `catch {}` treats every error as "not yet initialized". A persistent failure (provider
   constructor throw, storage failure) leaves the TUI spinning forever with no message.
   Reproduce: settings profile whose provider factory throws → TUI never becomes ready, no error
   shown.

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/interactive/types.ts` — add `memory_event` to
  `IInteractiveSessionEvents`
- `packages/agent-framework/src/interactive/interactive-session-history-tracker.ts` —
  `recordMemoryEvent` appends a user-visible history entry (mirror of
  `recordSkillActivationEvent`) and calls a new injected `emitMemoryEvent` callback
- `packages/agent-framework/src/interactive/interactive-session.ts` — wire
  `emitMemoryEvent: (e) => this.emit('memory_event', e)` at tracker construction
- `packages/agent-framework/src/memory/` — `formatMemoryEventMessage()` helper (message SSOT)
- `packages/agent-transport/src/tui/TuiInteractionChannel.ts` — subscribe `memory_event` →
  `syncHistory` (same pattern as `skill_activation`); init polling rewritten on a bounded poller
- `packages/agent-transport/src/tui/flows/session-init-poller.ts` — new pure poller module
  (interval + timeout + benign/real error split), unit-testable with fake timers

### Alternatives Considered

**A. Render memory events via a dedicated TUI notice channel (new state in TuiStateManager)**

- Pro: independent of history persistence
- Con: history is the established render path — `MessageList.EventEntry` already renders any
  `category: 'event'` entry's `data.message` generically (skill activations use exactly this);
  a second notice channel duplicates plumbing and skips persistence/resume for no benefit

**B. Append memory events to session history as `category: 'event'` entries + emit a session event (mirror skill_activation)**

- Pro: one render path, persisted and restored with the session, TUI change is a one-line
  subscription; message text owned by SDK (`formatMemoryEventMessage`) per CLI/TUI boundary
- Con: history grows slightly; mitigated by only appending user-meaningful types

**C. CLI-060 as a simple "max attempts" counter inside runInitCheck**

- Pro: tiny diff
- Con: keeps the untestable inline interval and the catch-all that conflates real errors with
  "not initialized"; a pure poller module with benign/real error split is the testable shape
  (matches the `flows/` pure-module convention, e.g. cjk-text-input-flow)

### Decision

**B + pure poller 채택** — memory events ride the existing history/event render path (the same
trade-off skill activations already settled), with only user-meaningful types
(`memory_candidate_saved`, `memory_candidate_approved`, `memory_candidate_rejected`,
`memory_retrieved`) appended to history while ALL types emit on `memory_event` for programmatic
listeners. Init polling moves into `flows/session-init-poller.ts` with: benign errors (message
matches "not initialized") → keep polling until a 15s timeout then surface a timeout failure;
real errors → surface immediately. Surfacing = state-manager error flag + a `category: 'event'`
history entry so the user sees a message, not an eternal spinner.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-framework (events/tracker/wiring/format),
      agent-transport (subscription + poller); CLI 무변경 (TUI는 SDK projection만 렌더)
- [x] Sibling scan 완료 — `recordSkillActivationEvent` (tracker:231-247)가 동일 요구의 기존
      해법: history append + injected emitter + persistSession. `memory_event`는 동일 형태로
      미러링. TUI 구독은 `skill_activation` 핸들러(채널:369-371, syncHistory)와 동일 패턴.
      poller는 `flows/cjk-text-input-flow.ts`의 pure-module 관례를 따름
- [x] 대안 최소 2개 검토 완료 — A(별도 notice 채널)/B(history+event 미러)/C(인라인 카운터)
- [x] 결정 근거 문서화 완료 — Decision 섹션 참조

## Solution

1. `formatMemoryEventMessage(event)` in `agent-framework/src/memory/` (e.g. "Memory saved: …",
   "Memory recalled (N items)") — SDK owns wording.
2. Tracker: `recordMemoryEvent` pushes to `memoryEvents`; for visible types appends
   `{category:'event', type:'memory-event', data:{...summary, message}}`; calls injected
   `emitMemoryEvent`; persists. Constructor gains the callback (mirror `emitSkillActivation`).
3. `types.ts`: `memory_event: (event: IMemoryEvent) => void`; `interactive-session.ts` wires the
   emitter.
4. `flows/session-init-poller.ts`: `createSessionInitPoller({ check, intervalMs, timeoutMs,
isBenignError, onReady, onFailure })` returning `{ start, stop }`; benign default = message
   contains "not initialized".
5. `TuiInteractionChannel`: replace inline interval with the poller (15s timeout); `onFailure`
   → `stateManager.onError()` + `stateManager.addEntry({category:'event',
type:'session-init-error', data:{message}})`; subscribe `memory_event` → `syncHistory`.

## Affected Files

- `packages/agent-framework/src/interactive/types.ts`
- `packages/agent-framework/src/interactive/interactive-session.ts`
- `packages/agent-framework/src/interactive/interactive-session-history-tracker.ts`
- `packages/agent-framework/src/memory/memory-event-format.ts` (new)
- `packages/agent-framework/src/interactive/__tests__/` (new tracker/emit tests)
- `packages/agent-transport/src/tui/TuiInteractionChannel.ts`
- `packages/agent-transport/src/tui/flows/session-init-poller.ts` (new) + tests
- `packages/agent-framework/docs/SPEC.md`, `packages/agent-transport/docs/SPEC.md`

## Completion Criteria

- [x] TC-01: `recordMemoryEvent({type:'memory_candidate_saved',…})` appends a history entry with
      `category:'event'`, `type:'memory-event'`, and a non-empty `data.message`, and invokes the
      injected `emitMemoryEvent` callback (tracker unit test)
- [x] TC-02: internal pipeline types (`memory_candidate_extracted/queued/skipped`) do NOT append
      history entries but still invoke `emitMemoryEvent` (tracker unit test)
- [x] TC-03: `InteractiveSession` emits `'memory_event'` to a subscribed listener when
      `recordMemoryEvent` is called (session-level test or wiring test)
- [x] TC-04: poller with a check that always throws "not initialized" calls `onFailure` with a
      timeout failure after `timeoutMs` (fake timers); a check that throws a real error calls
      `onFailure` immediately; a check that succeeds calls `onReady` and stops (poller unit tests)
- [x] TC-05: `TuiInteractionChannel` init failure path records a `session-init-error` event entry
      and sets the error state (channel test with mocked session, fake timers)
- [x] TC-06: `pnpm --filter @robota-sdk/agent-framework build/test` and
      `pnpm --filter @robota-sdk/agent-transport build/test` green; SPEC files updated

## Test Plan

| TC-ID | Test Type  | Tool / Approach                                            | Notes                                                                                                                                                               |
| ----- | ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | unit       | vitest — tracker recordMemoryEvent visible-type 케이스     | `packages/agent-framework/src/interactive/__tests__/session-history-tracker-memory-events.test.ts` > "TC-01: saved event appends a visible history entry and emits" |
| TC-02 | unit       | vitest — tracker internal-type 케이스                      | same file > "TC-02: internal type %s does not append history but still emits"                                                                                       |
| TC-03 | unit       | vitest — session.on('memory_event') wiring                 | `packages/agent-framework/src/interactive/__tests__/interactive-session.test.ts` > "TC-03: emits memory_event to subscribed listeners on recordMemoryEvent"         |
| TC-04 | unit       | vitest fake timers — poller timeout/real-error/ready 3분기 | `packages/agent-transport/src/tui/__tests__/session-init-poller.test.ts` > 3 "TC-04: …" tests                                                                       |
| TC-05 | unit       | vitest — channel + mocked InteractiveSession + fake timers | `packages/agent-transport/src/tui/__tests__/tui-channel-init-failure.test.ts` > "TC-05: a real init error records a session-init-error entry and sets error state"  |
| TC-06 | build/test | pnpm filter build + test (framework, transport)            | command evidence — see `[GATE-COMPLETE: TC-06]` and `[GATE-VERIFY]` entries                                                                                         |

## Tasks

- Tasks file: `.agents/tasks/completed/CLI-059.md` (archived 2026-06-11) (created 2026-06-11; 6 tasks T1–T6 mapped to TC-01~TC-06)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-11

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: OBSERVABILITY` is one of the 11 allowed prefixes; `tags: [cli, typescript]` present.
- Problem: concrete symptoms with file:line references (`interactive-session-history-tracker.ts:185`, `TuiInteractionChannel.ts:421-439`); reproduction conditions given for both sub-items (`/memory` API capture shows nothing in transcript; provider factory throw → eternal spinner); no TBD/TODO/vague single-sentence text.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan checked with completion evidence (`recordSkillActivationEvent` tracker:231-247 as existing solution, `skill_activation` TUI handler pattern, `flows/cjk-text-input-flow.ts` pure-module convention).
- Alternatives Considered: 3 entries (A notice channel / B history+event mirror / C inline counter), each with pro and con.
- Decision: references the driving trade-offs (same render-path trade-off skill activations settled; testable pure-poller shape vs. untestable inline interval).
- Completion Criteria: 6 items, all TC-N prefixed (TC-01–TC-06); at least one criterion per sub-feature (memory events: TC-01/02/03, poller: TC-04/05, build/spec: TC-06); all in command or observable-behavior form; no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly" absent).
- Test Plan: section present; 6 rows match 6 TC-N entries (count match confirmed); every row has non-empty Test Type and Tool/Approach, no "TBD"; no manual rows, so Notes-for-manual rule is N/A.
- Structure: `## Tasks` present with placeholder; `## Evidence Log` present and empty at gate run; no `## Status` or `## Classification` sections in the body.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-11

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation (2026-06-10): orchestrator presented 14 audit backlog items (CLI-049~062), including CLI-059 (memory events not surfaced) and CLI-060 (TUI init polling no timeout); user replied verbatim: "cjk 관련된 것 빼고 나머지 모두 진행해줘. pr을 올리면서 머지하며 작업해줘. feature 브랜치 -> develop -> main".
- Direct, unambiguous statement covering this spec: the approval authorizes all non-CJK items in the presented set; CLI-059/060 are not CJK-related, so this document (covering backlog CLI-059/060) is within the approved scope.
- No Architecture Review or frontmatter type/tags modifications after approval.
- NON-COMPLIANCE check: no implementation work (file edits, code commits) started for this scope before this gate ran.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-11

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-059.md` exists with 6 tasks — T1 (TC-01/02: formatMemoryEventMessage + tracker history append + emitMemoryEvent + tests), T2 (TC-03: memory_event in IInteractiveSessionEvents + session wiring + test), T3 (TC-04: flows/session-init-poller.ts pure module + fake-timer tests), T4 (TC-05: TuiInteractionChannel poller adoption + failure surfacing + memory_event subscription + channel test), T5 (TC-06: SPEC updates + build/test green both packages), T6 (backlog evidence recording).
- Tasks file path recorded in the `## Tasks` section of this spec (updated this gate run).
- Task ↔ TC correspondence verified: every TC-N (TC-01~TC-06) is covered by at least one task (TC-01/02→T1, TC-03→T2, TC-04→T3, TC-05→T4, TC-06→T5).
- NON-COMPLIANCE check: tasks file exists prior to implementation; no implementation-before-tasks-file violation.

### [GATE-COMPLETE: TC-01] — ✅ | 2026-06-11

**Test:** `packages/agent-framework/src/interactive/__tests__/session-history-tracker-memory-events.test.ts` > "TC-01: saved event appends a visible history entry and emits" + 3 parameterized visible-type cases — history entry `{category:'event', type:'memory-event'}` with non-empty `data.message`, emitter + persist called (pass).

### [GATE-COMPLETE: TC-02] — ✅ | 2026-06-11

**Test:** same file > parameterized "TC-02: internal type %s does not append history but still emits" for extracted/queued/skipped — history 0 entries, memoryEvents 1, emitter called (pass).

### [GATE-COMPLETE: TC-03] — ✅ | 2026-06-11

**Test:** `interactive-session.test.ts` > "TC-03: emits memory_event to subscribed listeners on recordMemoryEvent" (pass) — wiring `(event) => this.emit('memory_event', event)` at tracker construction.

### [GATE-COMPLETE: TC-04] — ✅ | 2026-06-11

**Test:** `packages/agent-transport/src/tui/__tests__/session-init-poller.test.ts` — 4 tests: ready stops polling; benign not-initialized errors retry until timeoutMs then `{kind:'timeout'}`; real error → `{kind:'error'}` immediately; stop() cancels (all pass, fake timers).

### [GATE-COMPLETE: TC-05] — ✅ | 2026-06-11

**Test:** `tui-channel-init-failure.test.ts` > "TC-05: a real init error records a session-init-error entry and sets error state" — mocked InteractiveSession whose getContextState throws ENOENT; after 400ms fake time the state manager history contains `type:'session-init-error'` with "Session initialization failed: … ENOENT" (pass).

### [GATE-COMPLETE: TC-06] — ✅ | 2026-06-11

**Commands:** agent-framework build ok / typecheck 0 / 890/890 tests; agent-transport build ok / typecheck 0 / 458/458 tests; downstream agent-cli build ok / 103/103. Lint 0 errors both. SPEC updated: framework events table + usage snippet (`memory_event`), transport TUI session-init polling section.

### [GATE-VERIFY] — ✅ PASS | 2026-06-11

**Status upgrade:** in-progress → verifying

- Tasks all complete: `.agents/tasks/completed/CLI-059.md` — all 6 tasks T1–T6 marked `[x]`, none blocked or pending.
- Build passes (affected packages): `pnpm --filter @robota-sdk/agent-framework build` → Build complete (exit 0); `pnpm --filter @robota-sdk/agent-transport build` → Build complete (exit 0). Repo-wide build excluded per caller scope.
- Tests pass: `pnpm --filter @robota-sdk/agent-framework test` → 88 files, 890/890 passed; `pnpm --filter @robota-sdk/agent-transport test` → 57 files, 458/458 passed. Both match expected counts.
- Note: gate run by guard subagent after frontmatter already read `verifying` and per-TC GATE-COMPLETE evidence was pre-recorded by the implementer; guard re-executed verification commands independently and confirmed green.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-11

**Status upgrade:** verifying → done

- Completion Criteria: all 6 TC checkboxes (TC-01–TC-06) are `[x]`.
- Per-TC evidence: `[GATE-COMPLETE: TC-N]` entries exist for all six TC-N with test references (TC-01–TC-05) or command evidence (TC-06).
- Test files verified on disk by guard: `packages/agent-framework/src/interactive/__tests__/session-history-tracker-memory-events.test.ts` (contains "TC-01: saved event appends a visible history entry and emits", parameterized "TC-02: internal type %s does not append history but still emits"); `packages/agent-framework/src/interactive/__tests__/interactive-session.test.ts` (contains "TC-03: emits memory_event to subscribed listeners on recordMemoryEvent"); `packages/agent-transport/src/tui/__tests__/session-init-poller.test.ts` (contains 3 "TC-04: …" tests); `packages/agent-transport/src/tui/__tests__/tui-channel-init-failure.test.ts` (contains "TC-05: a real init error records a session-init-error entry and sets error state").
- Test Plan: all 6 rows updated with test references (TC-01–TC-05) or command-evidence pointer (TC-06); no TC-N silently unaddressed; no skip-reason rows needed (no manual tests).
- Tasks file archived: `.agents/tasks/completed/CLI-059.md` exists; `## Tasks` section reflects the archived path.
- All referenced tests confirmed passing in the GATE-VERIFY runs above (890/890 framework, 458/458 transport).
