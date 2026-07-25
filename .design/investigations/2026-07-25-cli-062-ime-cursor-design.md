# CLI-062 Fix Design — real-cursor positioning for CJK IME (investigation, 2026-07-25)

Status: investigation complete, **POC-PASS**; implementation pending (blocked only on the CMD-004
Stage C branch freeing `agent-transport-tui`). This document is the implementation contract.

## TL;DR

The needed mechanism already exists upstream in the pinned ink (7.0.5): `useCursor().setCursorPosition({x,y})`
with y in live-frame coordinates, converted by ink into a relative `cursorUp` from the frame bottom and
written inside the same atomic `ESC[?2026`-bracketed frame write. The input row's absolute frame-space y
comes from walking the yoga `parentNode` chain from a `<Box ref>` — proven end-to-end in a pty PoC
(cursor lands exactly on the input row at the composition column, tracks CJK width growth, survives
cursor-only updates). The historical Terminal.app SIGSEGV came from a hardcoded `y: 0` pointing at the
logo area of a pre-`<Static>` layout — not from the mechanism.

## History (git archaeology)

| Commit                   | Fact                                                                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e0b9125a9` (2026-03-20) | `setCursorPosition({x: 4+stringWidth(before), y: 0})` — hardcoded y:0                                                                                                                         |
| `63d1c3b09` (2026-03-22) | Positioning removed; root cause recorded: cursor on logo area → Terminal.app `attributedSubstringFromRange:` null-deref (Apple-side bug)                                                      |
| `5195e326b` (2026-05-25) | Test branch with yoga parent-chain `getAbsolutePosition` — coordinates CORRECT, no crash; abandoned same day (`db83e84fe`) over a suspected double-cursor artifact + a debug-logging confound |

Since SCREEN-010, history+logo live in `<Static>` (zero live-frame height), so the live frame is ~7–10
rows and the yoga-chain y is directly in useCursor's coordinate space.

## Ink 7.0.5 facts (all verified in `node_modules/ink/build`; byte-identical in 7.1.1)

- `hooks/use-cursor.js`: render-time ref write; cleanup auto-propagates `undefined`. Built "for IME
  support" per readme (§useCursor, `examples/cursor-ime`).
- `cursor-helpers.js` `buildCursorSuffix(visibleLineCount, pos)` = `cursorUp(count−y)+cursorTo(x)+ESC[?25h`
  appended to the frame string — frame-bottom-relative, no absolute screen coords needed.
- `log-update.js`: cursor-only updates take a dedicated path; consumed only when `cursorDirty`.
- `reconciler.js` `resetAfterCommit`: insertion effects → `onComputeLayout()` → layout listeners
  (`useBoxMetrics`) → `onRender()` — a stale position self-heals within one frame.
- **Known defect (PoC-proven, present in 7.1.1 too):** when `frameHeight ≥ viewportRows` (ink's
  fullscreen path) the bottom-anchor assumption breaks — the cursor lands one row high, and an
  overflowing frame clamps `cursorUp` at the screen top (the original crash geometry). Candidate
  upstream issue/PR.
- `DOMElement`, `parentNode`, `yogaNode`, `useCursor`, `useBoxMetrics` are public exports (`index.d.ts:30-39`).

## Prior art

- **gemini-cli**: private ink fork (`npm:@jrichman/ink@6.6.9`) with renderer-side
  `<Text terminalCursorFocus terminalCursorPosition>` — same lineage as ink 7's `useCursor`; proves the
  UX and that a drawn inverse cursor can coexist with the hardware cursor.
- **Claude Code**: does NOT position the hardware cursor → composition window at bottom-left
  (anthropics/claude-code#25186, #27857). Not a model.

## PoC (scratchpad `poc/`, repo untouched)

Repo's installed ink+react under a real pty, TransportTUI-like layout, VT-interpreted output:
`POC-PASS` — `ESC[3A ESC[7G ESC[?25h` (input row, col = `> ` + `안녕`), +2 cols after one more wide
char via a cursor-only update, all inside synchronized-output brackets. 5-row pty probe demonstrates
the fullscreen off-by-one (invariant I2 evidence). Lesson: production hook must write NOTHING to any
stream (stderr writes corrupt ink's row accounting).

## Design (recommended mechanism: yoga parent-chain + useCursor)

- **Pure flow** `src/flows/real-cursor-flow.ts`:
  - `computeCursorCell({absX, absY, value, cursor, availableWidth})` → `{x,y}` reusing the wrap-aware
    `displayOffset` (`cjk-text-input-flow.ts:178`): `y = absY + floor(offset/width)`, `x = absX + offset%width`.
  - `shouldPositionRealCursor({hasMeasured, y, frameHeight, viewportRows, capability})` → boolean (invariants below).
- **Hook** `src/hooks/useRealCursorPosition.ts`: `useBoxMetrics(ref)` as the layout-change subscription;
  on notify, walk `parentNode` chain summing `getComputedLayout().left/top`; frame height from the
  `ink-root` yoga node; viewport rows via `useWindowSize`. Calls `setCursorPosition` during render with
  the last measured cell, or not at all when the guard fails. No stream writes, no logging.
- **`CjkTextInput.tsx`**: wrap `<Text>` in `<Box ref>`; suppress the drawn inverse cursor only while
  real positioning is active (`showCursor && focus && !realCursorActive`); fallback = today's visuals.
- **Capability gate** in `terminal-capabilities.ts`: `supportsImeCursorPositioning()` — Apple_Terminal
  false by default, `ROBOTA_IME_CURSOR=1` opt-in; other TTYs true. CLI-052 warning stays.

## Crash-avoidance invariants (code comments + tests)

- **I1** never a guessed row: position only with a y measured from the current yoga layout; before first
  measurement, don't position (`{y:0}` bug class unrepresentable).
- **I2** never into an overflowing frame: skip when `frameHeight ≥ viewportRows` or `y ∉ [0, frameHeight)`.
- **I3** never out-of-band: all movement rides ink's synchronized ≤30fps frame writes via `useCursor`.
- **I4** hide, don't guess, on fallback: guard fail/blur/unmount → no call → today's behavior.
- **I5** Apple_Terminal off by default until the manual matrix passes on real hardware.

## Test plan

1. Unit `computeCursorCell` table (ASCII / CJK wide / mid-string / wrap incl. wide-char straddle / empty+placeholder).
2. Unit `shouldPositionRealCursor` table — every false row is a SIGSEGV-invariant case.
3. PTY regression (node-pty devDep; serve-mode.bintest pattern): 24-row pty — every `ESC[?25h` within
   input-row bounds, never the top region; 5-row pty — zero positioned-show sequences (fallback).
   Mechanically regresses both the y:0 bug and the fullscreen off-by-one.
4. ink-testing-library: unfocused/disabled → no position; unmount → `undefined`.
5. Manual matrix per the backlog (iTerm2 + Terminal.app ±`ROBOTA_IME_CURSOR`, plus kitty/WezTerm/Ghostty/
   Windows Terminal/tmux).

## Feasibility verdict (honest)

- Achievable everywhere: hardware cursor on the input row at the composition column → IME window appears
  at the input position (fixes the reported symptom).
- Terminal-dependent: whether pre-edit TEXT renders inline in the cell — terminals draw it, apps cannot
  (no pre-edit events over stdin; true for every Node TUI incl. gemini-cli). iTerm2/kitty/WezTerm/
  Ghostty/VTE/Windows Terminal draw at the cursor cell (inline experience); some others float the window
  adjacent — still the big win vs bottom-of-screen.
- Terminal.app: crash is Apple's bug; trigger geometry gone with a valid y + tiny post-`<Static>` frame,
  but ships disabled by default there (I5) pending supervised manual verification.
- Housekeeping: `agent-transport-tui/package.json` declares ink `^7.1.1`, lockfile resolves 7.0.5
  (cursor internals byte-identical) — reconcile in the implementation PR.

Key files: `src/CjkTextInput.tsx`, `src/InputArea.tsx:263-324`, `src/App.tsx:461-479,567-608`,
`src/flows/cjk-text-input-flow.ts:178-199`, `src/terminal-capabilities.ts`,
`packages/agent-cli/src/startup/terminal-check.ts`. Historical commits: `e0b9125a9`, `63d1c3b09`,
`5195e326b`, `db83e84fe`.
