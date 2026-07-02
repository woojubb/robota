---
title: 'SCREEN-014: Define + implement arrow-key navigation into the inline background-work list'
status: done
created: 2026-06-30
priority: high
urgency: now
area: packages/agent-transport-tui
depends_on: []
supersedes_note: 'Revises SCREEN-013 — the Ctrl+B hint was a workaround, not the intended interaction.'
---

# Arrow-key navigation into the background-work list

## Problem (observed)

In the live agent-cli TUI, the "Background work" list is visible but **cannot be reached the way a user
expects**: arrow keys do nothing to it (they drive prompt history), there is no focus/selection on the
inline list, and the only real entry point is a separate `Ctrl+B` modal switcher that is confusing and
feels broken. Trying to reach a background task via slash commands is also unclear. By contrast, the
reference UX (Claude Code) lets you **just press ↓ to move into the bottom background list and Enter to
open it** — no modal, no command.

SCREEN-013 only added a `Ctrl+B` hint, which did not define or deliver the intended interaction. This
item defines the interaction model first, then implements it, then locks it with regression tests.

## Target interaction model (to confirm before implementation)

Two focus zones: **(A) the prompt input** (default) and **(B) the inline background-work list** (only
when it has entries).

1. **Enter the list:** from the prompt input, pressing **↓** when the caret is on the last line and
   there is no forward prompt-history left moves focus to the **first** background-work item (a
   highlighted selection appears). This is the same "fall through the bottom of the input into the
   list" behaviour as the reference UX. (Prompt-history ↑/↓ is unchanged while history remains.)
2. **Move within the list:** **↑/↓** move the highlight between background items. **↑** past the first
   item returns focus to the prompt input.
3. **Open a task:** **Enter** on the highlighted item opens that task's detail (the existing
   `ExecutionWorkspaceDetailPane` via `selectExecutionWorkspaceEntry` + `readExecutionWorkspaceDetail`)
   — inline, no modal.
4. **Leave:** **Esc** from the list returns focus to the input; **Esc** from a task detail returns to
   the list (or input). The main thread stays selected/active for prompting.
5. **Affordance:** the panel shows a subtle, focus-aware hint (e.g. "↑↓ select · Enter open" when
   focusable) instead of the current `Ctrl+B` text.

The order shown is the stable order from SCREEN-010 so the highlight is predictable.

## Confirmed decisions (2026-06-30)

- **D1 — entry key: ↓ fall-through.** From the input, ↓ at the caret's last line with no forward
  prompt-history moves focus to the first background item (reference-style). Prompt-history ↑/↓
  unchanged while history remains.
- **D2 — Ctrl+B switcher: keep as secondary.** Inline arrow-key navigation is the primary path; the
  Ctrl+B switcher stays as the full execution-workspace overlay (incl. main thread).
- **D3 — keyboard only, no slash command.** Do not add a background slash command; remove/clean up any
  confusing existing background command surface so the keyboard path is the single clear way in.
- **D4 — inline detail pane.** Enter opens the existing `ExecutionWorkspaceDetailPane` inline (no modal).

## Test Plan

- Component/interaction tests (ink-testing-library): ↓ from the input focuses the first item; ↑/↓ move
  the highlight; ↑ past the top returns to the input; Enter opens the detail pane and triggers
  `readExecutionWorkspaceDetail`; Esc unwinds focus. Prompt-history ↑/↓ still works while history
  remains (no regression).
- PTY E2E (extends TEST-010, needs the deterministic background-task seed): with ≥2 seeded background
  tasks in the real binary, ↓ + Enter opens a task's detail; ↑ returns to the input.
- typecheck / lint / `pnpm --filter @robota-sdk/agent-transport-tui test` + `test:pty` green; the
  `tui-e2e` CI job covers it.

## User Execution Test Scenarios

- Prereq: built CLI; a session with ≥2 running background agents.
- Steps: run `robota`, spawn ≥2 background agents, ensure the prompt input is empty, press **↓** once
  (focus enters the list), press **↓** to highlight the second task, press **Enter**.
- Expected: ↓ moves a visible highlight into the bottom background list; Enter opens that task's detail
  (status/output); **↑** from the top of the list returns to the prompt; no modal is required.
- Evidence (automated, agent-run): `background-focus-flow.test.ts` (6) exhaustively covers the
  ↑/↓/Enter/Esc/empty navigation reducer; `input-area-focus-handoff.test.tsx` (2) proves ↓ on an
  empty input requests list focus (and not while disabled); `background-task-panel.test.tsx` covers
  the focus highlight + focus-aware hint. Full TUI suite green (392), real-binary PTY smoke green.
- Evidence (LIVE end-to-end, agent-run 2026-07-02): real TUI in a PTY (real Anthropic provider) with
  a real background agent spawned by the model — no seed needed. On the idle empty input, **↓**
  flipped the panel hint to `↑↓ select · Enter open · Esc back` (focus entered the inline list);
  **Enter** opened that entry inline — the status bar showed `[tides]` and the main pane rendered the
  task's live transcript (`… Tides are the periodic rise and fall of sea levels …`); **Esc/↑**
  restored the prompt and the unfocused `↓ select · Ctrl+B all` hint. The full live
  ↓ → highlight → Enter → inline-detail → back flow ran as a single end-to-end session — the
  previously-remaining gate is closed.
