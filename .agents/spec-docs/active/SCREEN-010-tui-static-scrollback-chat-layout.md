---
status: in-progress
type: SCREEN
tags: [cli]
---

# SCREEN-010: Chat-window layout — committed history to native scrollback via Ink `<Static>`

## Problem

The TUI re-renders the entire conversation on every frame, so it does not behave like a chat window
(committed messages pinned in scrollback, input fixed at the bottom). In `App.tsx` the whole
conversation is drawn dynamically:

```tsx
<Box flexDirection="column" paddingX={1} flexGrow={1}>
  <MessageList history={history} />   {/* history.map(...) — re-rendered every frame */}
  {/* streaming indicator, background panel */}
</Box>
<InputArea ... />
<SessionStatusBar ... />
```

`MessageList` (`MessageList.tsx`) maps `history.map(entry => <EntryItem key={entry.id} />)` inside a
plain dynamic `<Box>`. Consequences:

- On long conversations the full history sits in Ink's live frame and is re-diffed each render →
  flicker and wasted work.
- The input is not decoupled from history: there is no "committed to terminal scrollback" region, so
  the user cannot scroll back through past messages with the input staying pinned at the bottom the
  way Claude Code's TUI does.

`<Static>` is currently used only for the startup banner (`App.tsx` ~line 377), proving the mechanism
is already available and working in this app.

Goal (Model A, "Claude Code style"): finalized conversation entries render via Ink `<Static>` so they
commit once to the terminal's **native scrollback** (scrollable by the terminal: trackpad / mouse /
Shift+PageUp), while the input area + status bar + in-flight streaming message remain the dynamic
"live region" pinned at the bottom.

Reproduction: `pnpm cli:dev` → hold a multi-message conversation longer than the viewport → observe
that the whole history re-renders (flicker) and scrolling does not behave like a committed chat log.

## Architecture Review

### Affected Scope

- `packages/agent-transport-tui/src/App.tsx` — render committed history through `<Static items>`;
  keep input/status/in-flight streaming dynamic; classify the conditional mid-panels.
- `packages/agent-transport-tui/src/MessageList.tsx` — split into a `<Static>`-friendly committed
  renderer (per-entry `EntryItem`, already keyed by `entry.id`) vs. an in-flight tail.
- Interaction (no code owner change, but must be designed together):
  `packages/agent-transport-tui/src/terminal-handoff-controller.ts` +
  `hooks/useTerminalHandoffSuspension.ts` — suspend renders an empty tree and resume re-renders;
  `<Static>` re-emits all committed items on re-mount, so the handoff resume path must not dump the
  whole history again.

### Alternatives Considered

**Alt A (chosen): Ink `<Static>` committed history + dynamic live region (terminal-native scrollback)**

- Pro: idiomatic Ink, the exact mechanism Claude Code uses; we already use `<Static>` for the banner;
  no per-frame re-diff of history (no flicker, efficient); fits our append-only + read-only history
  ([[feedback_history_append_only]]) and stable `entry.id` keys perfectly — committed items never
  need to change.
- Pro: input/status are the only pinned live region → input "stays at the bottom" during normal use.
- Con: scrolling is the terminal's native scrollback (not app keybindings); when scrolled up the
  input scrolls away visually — this matches Claude Code and is accepted.
- Con: committed `<Static>` items are measured at commit width and do not reflow on terminal resize
  (accepted limitation; also true of Claude Code).

**Alt B (rejected): App-managed scroll viewport (alternate screen + custom scroll region)**

- Pro: input can remain visible even while scrolling output (true split-pane).
- Con: Ink provides no scroll viewport; requires alternate-screen takeover + custom height
  measurement / visible-row slicing / PageUp-Down handling — large, fragile, reinvents the terminal,
  and is not what the user asked for ("claude code처럼"). Explicitly out of scope.

### Decision

Alt A. Move finalized entries into `<Static>`; keep input, status bar, and the in-flight streaming
message dynamic. Solve the streaming→commit transition and the handoff re-mount re-emit as first-class
requirements.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-transport-tui (App, MessageList) + handoff interaction
- [x] Sibling scan 완료 — StreamingIndicator / BackgroundTaskPanel / ExecutionWorkspaceDetailPane
      classified as live; PermissionPrompt / pickers remain transient overlays (already outside MessageList)
- [x] 대안 최소 2개 검토 완료 (A Static / B app-managed viewport)
- [x] 결정 근거 문서화 완료

## Solution

1. **Commit finalized history to `<Static>`.** In `App.tsx`, replace the dynamic
   `<MessageList history={history} />` with `<Static items={committedHistory}>{(entry) => <EntryItem
key={entry.id} entry={entry} />}</Static>`, exporting `EntryItem` from `MessageList.tsx`.
   `committedHistory` excludes the entry currently being streamed.
2. **In-flight tail stays dynamic.** The currently-streaming assistant message + `StreamingIndicator`
   - thinking/tool indicators render in the dynamic region directly above the input. When a streamed
     message finalizes (lands in `history` as a completed entry), it naturally moves into the `<Static>`
     set on the next render and is committed once.
3. **Live region order (pinned bottom):** in-flight tail → `BackgroundTaskPanel` → context warning →
   `InputArea` → `SessionStatusBar`. These re-render; committed history does not.
4. **Handoff re-mount safety.** Ensure the terminal-handoff suspend/resume (and session
   resume/switch) does not visibly re-print the entire committed history. Design the suspend path so
   `<Static>` is not forced to re-emit all items on resume (e.g. keep the Ink instance mounted with a
   minimal live region during handoff rather than swapping the whole tree), and verify in the PTY E2E.
5. **Mid-panels:** keep `ExecutionWorkspaceDetailPane` as a dynamic alternate view (it replaces the
   message list today); it is not part of the committed chat log.

### Key finding during implementation (2026-06-28): only the front-window was incompatible

Initial analysis worried that `TuiStateManager.syncHistory(getFullHistory())` **replaces** `history`
(and that local `addEntry` echoes interleave with it), which seemed to require a full append-only
rewrite. An append-only-merge-by-id approach was prototyped and **reverted** — it broke the
established display contracts (CLI-B05: `user_message` immediately adds a `role=user` entry; the
local echo's id differs from the session's, so id-dedup forced an awkward live-echo split).

The correct, minimal insight: **Ink `<Static>` is count-based** — it renders only items beyond the
count it has already emitted and never re-touches committed items. So the existing **"replace on
complete"** semantics already work with `<Static>` _as long as the list grows monotonically_, which
the session history does during a session. The **only** real incompatibility was the
`MAX_RENDERED_MESSAGES` (100) **front-slice**, which shrinks/shifts the prefix and breaks the count.

Implemented approach (minimal, contract-preserving):

- **Remove the `MAX_RENDERED_MESSAGES` front-window** in `addEntry`/`syncHistory`. Committed entries
  live in terminal scrollback (no per-frame cost), so windowing is obsolete. `syncHistory` keeps its
  SSOT **replace** semantics; `addEntry` keeps appending the immediate echo. All display contracts
  (D1/D2/D3/D7) pass unchanged.
- The immediate user-message echo stays in `history` (CLI-B05 preserved); on `complete`,
  `syncHistory(getFullHistory())` replaces with the authoritative session history (longer, same
  chronological prefix), and `<Static>` emits only the new tail — no duplicate.
- Compaction (history shrinks) is the one edge: already-committed scrollback lines cannot be
  un-printed (true of any scrollback chat); the compacted summary is the model's concern. Acceptable.

### Implementation sequence (as built)

1. Remove the front-window (Static-compatibility); unit test that >100 / 250 entries are all kept
   (TC-09, reframed: no front-truncation).
2. Unify banner + committed history into a single `<Static>`; render the live region conditionally so
   `<Static>` stays mounted at a stable tree position across handoff suspend/resume (solves TC-04 —
   no full re-print on resume; input still unmounts to release raw mode per TERM-002).
3. Live tail (streaming/indicators/panels) + input + status bar remain dynamic.

## Affected Files

- `packages/agent-transport-tui/src/App.tsx`
- `packages/agent-transport-tui/src/MessageList.tsx`
- (design-coupled, verify only) `packages/agent-transport-tui/src/terminal-handoff-controller.ts`,
  `packages/agent-transport-tui/src/hooks/useTerminalHandoffSuspension.ts`

## Completion Criteria

- [ ] TC-01: finalized conversation entries are emitted via Ink `<Static>` (committed to terminal
      scrollback) and are not re-rendered on subsequent frames.
- [ ] TC-02: the input area + status bar remain pinned at the bottom as the live region; only the
      live region re-renders during streaming.
- [ ] TC-03: an in-flight streaming assistant message renders in the dynamic region while streaming
      and appears exactly once in the committed (Static) output after it finalizes (no duplicate, no
      missing entry).
- [ ] TC-04: a terminal-handoff (`/shell`) suspend→resume does not visibly re-print the entire
      committed history; the live region restores cleanly (regression guard against the SCREEN-010 ×
      TERM-002 interaction).
- [ ] TC-05: on a real terminal, past messages are reachable via native scrollback while the input
      stays at the bottom during normal (non-scrolled) use.
- [ ] TC-06: `pnpm --filter @robota-sdk/agent-transport-tui typecheck` exits 0.
- [ ] TC-07: `pnpm --filter @robota-sdk/agent-transport-tui test` exits 0 with no new failures.
- [ ] TC-08: `pnpm --filter @robota-sdk/agent-transport-tui build` exits 0; `pnpm harness:scan` green.
- [ ] TC-09: the committed-history list is not front-truncated — `syncHistory`/`addEntry` keep the
      full session history (no `MAX_RENDERED_MESSAGES` cap), so Ink `<Static>` can render the growing
      tail (unit test on `TuiStateManager` with >100/250 entries).

## Test Plan

Test strategy derived from type=SCREEN, tags=[cli]: ink-testing-library output assertions + PTY E2E
(TEST-007 harness) + visual smoke for the parts only a human can certify.

| TC-ID | Test Type | Tool / Approach                                                                                | Notes                                                                  |
| ----- | --------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| TC-01 | automated | PTY E2E (`terminal-handoff.ptytest.ts`): banner committed via `<Static>` appears in scrollback | Real-terminal evidence (Static writes to real stdout) — DONE           |
| TC-02 | deferred  | record/replay cassette driver (needs a model response) → INFRA-016 harness                     | Streaming→commit timing; manager units pin the replace/no-window basis |
| TC-03 | deferred  | record/replay cassette driver (needs a model response) → INFRA-016 harness                     | Streaming→commit single-copy; deferred with TC-02                      |
| TC-04 | automated | PTY E2E (`terminal-handoff.ptytest.ts`): `/shell` handoff, banner count unchanged on resume    | No re-print; ties SCREEN-010 to TERM-002 — DONE                        |
| TC-05 | manual    | `pnpm cli:dev`, multi-message convo, scroll back via terminal                                  | Native-scrollback feel cannot be fully asserted in vitest              |
| TC-06 | automated | `pnpm typecheck`                                                                               | Must exit 0                                                            |
| TC-07 | automated | `pnpm test` (vitest)                                                                           | No regressions                                                         |
| TC-08 | automated | `pnpm build` + `pnpm harness:scan`                                                             | Must exit 0 / all scans green                                          |
| TC-09 | automated | vitest on `TuiStateManager`: interleave addEntry/syncHistory, assert monotonic + no dup        | Foundation for Static append-only correctness                          |

## User Execution Test Scenarios

- Prereq: built CLI, interactive terminal (`pnpm cli:dev` or built binary).
- Steps: launch the TUI; hold a conversation with several assistant responses (longer than the
  viewport); scroll up through past messages using the terminal (trackpad / mouse / Shift+PageUp);
  send another message.
- Expected: past messages are in the terminal scrollback and scroll smoothly; during normal use the
  input box and status bar stay pinned at the bottom; a streaming response appears live above the
  input and, once complete, becomes a committed scrollback entry with no flicker or duplication.
- Cross-check: run `/shell echo hi` (terminal handoff) mid-session and confirm that on return the
  whole history is not re-printed and the input restores cleanly.
- Cleanup: exit the TUI.
- Evidence: _to be filled after implementation._

## Tasks

- [x] `.agents/tasks/SCREEN-010.md` — created (GATE-IMPLEMENT)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-28

- Frontmatter: `---` block present; `status: draft` (now upgraded); `type: SCREEN` (valid prefix); `tags: [cli]` present.
- Problem: concrete symptom (App.tsx renders full conversation dynamically; MessageList `history.map` re-renders every frame; cited line ~377 Static-only-banner) + reproduction (`pnpm cli:dev`, multi-message convo > viewport); no TBD/TODO.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with classification evidence; 2 alternatives (A Static / B app-managed viewport) each with pro/con; decision references the trade-off (idiomatic Ink + append-only fit vs. viewport reinvents terminal).
- Completion Criteria: TC-01–TC-08 all TC-prefixed; observable-behavior / command form; no banned vague phrases.
- Test Plan: present; 8 rows matching TC-01–TC-08 (count matches); each row has Test Type + Tool; the single `manual` row (TC-05) has a Notes justification.
- Structure: Tasks section with placeholder present; Evidence Log was empty at first run; no `## Status` / `## Classification` body sections.
- Result: PASS → status `draft` → `review-ready`; file moves `draft/` → `backlog/`.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-28

- Prior gate: GATE-WRITE shows ✅ PASS above; status was `review-ready` in `backlog/` (correct input stage).
- Explicit user approval (verbatim): "승인한다. ... 기존 작업 승인한다" — a direct, unambiguous statement confirming the SCREEN-010 design (Model A) and authorizing implementation.
- No Architecture Review / frontmatter type/tags modified after approval.
- Result: PASS → status `review-ready` → `approved`; file moves `backlog/` → `todo/`.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-28

- Prior gate: GATE-APPROVAL shows ✅ PASS above.
- Tasks file created: `.agents/tasks/SCREEN-010.md`, path recorded in `## Tasks`.
- Tasks correspond to TC-01–TC-08 (≥1 task per TC); tasks file carries a `## Test Plan` section.
- Result: PASS → status `approved` → `in-progress`; file moves `todo/` → `active/`.

### Implementation progress | 2026-06-28 (pre-GATE-VERIFY)

Implemented (all green):

- **Foundation (TC-09):** removed `MAX_RENDERED_MESSAGES` front-window in `TuiStateManager`;
  `syncHistory` keeps SSOT-replace, `addEntry` keeps append. Unit test asserts 250 entries are all
  kept. (`tui-state-manager.test.ts`, 27 tests pass.)
- **Static migration:** `App.tsx` renders banner + committed `history` through a single `<Static>`
  (committed to terminal scrollback); `EntryItem` exported from `MessageList.tsx`.
- **Handoff-safe live region (TC-04 mechanism):** replaced the `if (handoffSuspended) return <Box/>`
  early-return with a conditional live region, so `<Static>` stays mounted at a stable tree position
  across handoff suspend/resume (no full history re-print); input still unmounts to release raw mode.
- **Display contracts preserved:** D1/D2/D3/D7 (immediate `user_message` echo + replace-on-complete)
  pass **unchanged**.
- **Gates:** TUI typecheck clean; full TUI suite **394 tests pass**; `test:pty` **3 tests pass**
  (boot, /help, /exit, /shell handoff on the real binary with the new Static rendering); TC-06/07/08.

Decision (2026-06-28, user-approved): cover the Static behavior via **PTY E2E** rather than build a
new full-`<App>` ink-testing harness — `<Static>` is real-terminal behavior, and ink-testing's mock
stdout does not faithfully reproduce scrollback (weaker evidence) while the TEST-007 PTY harness
already exists.

- **TC-01 (committed → scrollback) + TC-04 (no re-print after handoff): DONE.**
  `terminal-handoff.ptytest.ts` "TC-04/TC-01" boots the built binary, counts the banner version line
  committed via `<Static>`, runs `/shell` (handoff), and asserts the banner count is unchanged after
  resume (committed history not re-emitted). Passes on the real terminal.

Pending before GATE-VERIFY / done:

- **TC-02/03 (streaming → commit transition):** require a model response, so a record/replay cassette
  driver is needed (TEST-005-style). Deferred to the INFRA-016 testing-harness work; the manager
  unit tests already pin the underlying replace/no-window semantics.
- **TC-05 (manual real-terminal scrollback smoke):** pending.
