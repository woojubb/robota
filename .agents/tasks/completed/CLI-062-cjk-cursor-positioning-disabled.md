---
title: 'CLI-062: CJK input real terminal cursor positioning disabled (Terminal.app SIGSEGV workaround)'
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2442#issuecomment-5455751558
created: 2026-06-10
priority: low
urgency: later
area: packages/agent-transport-tui
depends_on: []
---

# CLI-062: CJK input cursor positioning disabled

> **2026-07-25 — owner re-prioritized (composition cursor still appears below the input box).**
> Investigation COMPLETE with POC-PASS: see
> [`.design/investigations/2026-07-25-cli-062-ime-cursor-design.md`](../../.design/investigations/2026-07-25-cli-062-ime-cursor-design.md)
> — that document is the implementation contract (mechanism: yoga parent-chain absolute y +
> ink `useCursor`; SIGSEGV root-caused to the historical hardcoded `y: 0`, with five crash-avoidance
> invariants I1–I5 and a pty regression plan). Implementation starts as soon as the CMD-004 Stage C
> branch frees `agent-transport-tui`.

> **2026-07-25 — IMPLEMENTED per the contract (PR: feat/cli-062-ime-cursor).** Shipped in
> `packages/agent-transport-tui`: `src/flows/real-cursor-flow.ts` (pure `computeCursorCell` +
> `shouldPositionRealCursor`), `src/hooks/useRealCursorPosition.ts` (yoga parent-chain origin +
> `useCursor`, zero stream writes), `CjkTextInput` `<Box ref>` wiring with drawn-cursor
> suppression only while active, `supportsImeCursorPositioning()` gate (Apple_Terminal off by
> default, `ROBOTA_IME_CURSOR=1` opt-in / `=0` kill switch). Invariants I1–I5 each carry a code
> comment + test; red-before-green proven — component + 24-row pty were RED pre-change
> (`expected 0 to be greater than 0`); fallback pinned byte-identical
> (`src/__tests__/cjk-fallback-render.test.tsx`). PTY regression:
> `src/__tests__/pty/ime-cursor.ptytest.ts` (24-row: every post-boot `ESC[?25h` on the input row
> at the composition column; 5-row: zero shows — I2). Housekeeping note: the design doc's
> "lockfile resolves ink 7.0.5" observation is stale — develop's lockfile resolves the declared
> `^7.1.1` (7.1.1) for both TUI packages; cursor internals verified byte-identical between
> 7.0.5/7.1.1, so no dependency change was made.
>
> **2026-07-26 — the terminal matrix is now AGENT-RUN, not a manual chore.** It was converted into
> a re-runnable suite instead of being handed to the owner as a terminal-eyeballing task. See the
> "Terminal matrix" section below for the per-cell evidence, and
> [`.agents/evals/scenarios/cli-062-ime-cursor-agent-run.md`](../evals/scenarios/cli-062-ime-cursor-agent-run.md)
> for the full run log.
>
> **REMAINING (do not archive) — narrowed to the two macOS cells only:** Terminal.app and iTerm2
> running on macOS _with a Korean IME_. Their environment branches (including Apple_Terminal's
> default-off I5 branch and the `ROBOTA_IME_CURSOR=1` opt-in) are already asserted end-to-end, but
> the emulators' own rendering — inline pre-edit display, and above all whether Apple's
> `attributedSubstringFromRange:` SIGSEGV can still be provoked — cannot be observed off macOS.
> I5 keeps Apple_Terminal off by default until those two cells are run.

## Problem

(Historical, as filed 2026-06-10.) Real terminal cursor positioning for the CJK text input was
intentionally disabled in the then-current `packages/agent-transport/src/tui/CjkTextInput.tsx`
(the component now lives in `packages/agent-transport-tui`) — `setCursorPosition(x, 0)` crashed
Terminal.app via Korean IME SIGSEGV, and the correct fix needs the input row's y offset which
Ink does not expose. As a result the OS-level IME composition window can appear at the wrong
screen position during Hangul editing, and visual cursor feedback relies solely on the drawn
block cursor.

## Expected Behavior

Safe cursor synchronization restored: compute the input row's y offset (e.g. via Ink
measureElement/DOM node position or output-height accounting) and position the real cursor
only when the offset is known, never calling `setCursorPosition` with a guessed row. Must not
reintroduce the Terminal.app SIGSEGV (regression-test alongside CLI-052's warning).

## Test Plan

- Unit tests for the offset computation given mocked render heights. — **done**
  (`src/flows/__tests__/real-cursor-flow.test.ts`)
- Terminal matrix. — **done as an automated suite** (see below); only the two macOS cells remain.
- `pnpm --filter @robota-sdk/agent-transport-tui build && pnpm --filter @robota-sdk/agent-transport-tui test`
  and `pnpm --filter @robota-sdk/agent-transport-tui test:pty`

## Terminal matrix (agent-run, 2026-07-26)

The matrix is a suite, not a checklist. Two halves share one table
(`src/__tests__/helpers/terminal-profiles.ts`) so terminal detection and observable behaviour can
never drift apart:

- `src/__tests__/terminal-capabilities.test.ts` — what `supportsImeCursorPositioning()` returns for
  each terminal's real environment handshake.
- `src/__tests__/pty/ime-cursor.ptytest.ts` — what the BUILT binary then does in a real pty:
  24 rows, type `안녕`, and require every post-boot `ESC[?25h` to sit on the input row at the
  composition column — or, for a gated-off cell, require zero cursor shows. Plus a 5-row probe
  (invariant I2) wherever the gate would otherwise allow positioning.
- `src/__tests__/pty/ime-cursor-tmux.ptytest.ts` — tmux runs the binary in a real pane and reports
  its OWN cursor position back, so a second VT implementation confirms the cell.

| Terminal             | env provenance                    | unset             | `=1`         | `=0`         |
| -------------------- | --------------------------------- | ----------------- | ------------ | ------------ |
| bare TTY             | measured (the pty harness itself) | ✅ positions      | ✅ positions | ✅ no cursor |
| Ghostty 1.3.1        | measured (launched here)          | ✅ positions      | ✅ positions | ✅ no cursor |
| GNOME Terminal / VTE | measured (launched here)          | ✅ positions      | ✅ positions | ✅ no cursor |
| tmux 3.4             | measured + **real emulator run**  | ✅ positions      | ✅ positions | ✅ no cursor |
| kitty                | documented                        | ✅ positions      | ✅ positions | ✅ no cursor |
| WezTerm              | documented                        | ✅ positions      | ✅ positions | ✅ no cursor |
| Windows Terminal     | documented                        | ✅ positions      | ✅ positions | ✅ no cursor |
| iTerm2 (macOS)       | documented — env branch only      | ✅ positions      | ✅ positions | ✅ no cursor |
| Terminal.app (macOS) | documented — env branch only      | ✅ no cursor (I5) | ✅ positions | ✅ no cursor |

Terminals actually executed on this machine: **Ghostty 1.3.1** and **GNOME Terminal 3.52.0 / VTE
0.76.0** (launched under Xvfb to capture the environment they export) and **tmux 3.4** (drove the
binary end-to-end in a real pane). kitty, WezTerm and Windows Terminal are not installed here and
the two macOS emulators cannot run on Linux at all: for those rows the cell exercises OUR branch
under the environment that terminal exports, which is real coverage of the code but is NOT evidence
about the emulator's own rendering or its OS IME. That distinction is recorded per row in
`terminal-profiles.ts` (`provenance: measured | documented`).

Real-emulator readout (tmux `#{cursor_x} #{cursor_y} #{cursor_flag}`):

```
24 rows, unset : 7 19 1   visible, row 19 = the ` > 안녕` input row, col 7 = 1 + '> ' + 안녕(4 cols)
24 rows, =0    : 0 23 0   hidden, parked at the frame bottom
 5 rows, unset : 8  4 0   hidden — I2 refuses to position into a frame >= viewport
```

## What remains — macOS only

Two cells cannot be run off macOS. Everything needed to close them is here, so it is a five-minute
job rather than a re-derivation:

```bash
# On macOS, with a Korean IME (한글) active. Build first:
pnpm install && pnpm build

# Cell 1 — Terminal.app, default (I5): expect NO hardware-cursor positioning; the composition
# window keeps today's behaviour and, critically, Terminal.app must not crash.
#   Open Terminal.app, then:
node packages/agent-cli/bin/robota.cjs
#   Type Korean mid-line, move with arrow keys while composing. Watch for a SIGSEGV.

# Cell 2 — Terminal.app, opt-in: expect the composition window AT the input position.
ROBOTA_IME_CURSOR=1 node packages/agent-cli/bin/robota.cjs

# Cell 3/4 — iTerm2, both settings (iTerm2 is on by default):
node packages/agent-cli/bin/robota.cjs
ROBOTA_IME_CURSOR=0 node packages/agent-cli/bin/robota.cjs   # kill switch: no positioning

# The automated cells for these two terminals' env branches, runnable anywhere:
cd packages/agent-transport-tui
npx vitest run --config vitest.pty.config.ts src/__tests__/pty/ime-cursor.ptytest.ts -t "Terminal.app"
npx vitest run --config vitest.pty.config.ts src/__tests__/pty/ime-cursor.ptytest.ts -t "iTerm2"
```

If Cell 1 shows no crash across a full Korean editing session, flip Apple_Terminal's default in
`supportsImeCursorPositioning()` (drop the I5 branch) and archive this item.

**Confirmed 2026-07-26 (backlog reconciliation): the two macOS cells are the ONLY remainder.** Checked
against the tree rather than against this document:

- The matrix is a real suite, not a checklist — `packages/agent-transport-tui/src/__tests__/pty/`
  contains `ime-cursor.ptytest.ts` and `ime-cursor-tmux.ptytest.ts`, and the shared table is
  `packages/agent-transport-tui/src/__tests__/helpers/terminal-profiles.ts`.
- Provenance is machine-readable and matches the table above: `terminal-profiles.ts` marks the bare
  TTY, Ghostty, VTE and tmux rows `provenance: 'measured'` (`:42,54,61,68`) and kitty, WezTerm,
  Windows Terminal, iTerm2, Terminal.app `provenance: 'documented'` (`:75,82,89,96,103`). Exactly two
  `documented` rows are macOS emulators that cannot run on Linux — iTerm2 (`:94-96`) and
  Terminal.app (`:102-103`).
- I5 is still armed: `terminal-profiles.ts:123` — `return profile.env['TERM_PROGRAM'] !== 'Apple_Terminal'`.
  So Terminal.app is off by default and the SIGSEGV cannot be provoked by the shipped default; the
  cells decide whether that default can be dropped, not whether the feature works.

No other cell, test, or code path is outstanding. This is a hardware-availability block, not
unfinished engineering.

## User Execution Test Scenarios

- Prerequisite: a machine with a terminal emulator; the built CLI binary. No macOS required for the
  agent-run cells.
- Steps: run the three suites listed under "Terminal matrix" above.
- Expected observable result: in every enabled cell the hardware cursor sits on the input row at the
  composition column — the cell an OS IME anchors its window to — and in every gated-off cell no
  cursor is shown at all; tmux independently confirms the same cell.
- Cleanup: none (each cell uses a throwaway project/HOME dir).
- Evidence: [`.agents/evals/scenarios/cli-062-ime-cursor-agent-run.md`](../evals/scenarios/cli-062-ime-cursor-agent-run.md)
  — full per-cell run log, the measured terminal environments, the tmux cursor readouts, and the
  red-before-green mutation proof.
- **Not covered:** the macOS composition-window screenshot and the Terminal.app no-crash check —
  see "What remains — macOS only".
