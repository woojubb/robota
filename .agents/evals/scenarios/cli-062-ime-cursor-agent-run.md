# CLI-062 — real terminal-cursor positioning for CJK IME composition (agent-run)

**Spec:** CLI-062 (IME composition window appears at the bottom of the screen because the hardware
cursor is never positioned; the historical fix attempt SIGSEGV'd Terminal.app via a hardcoded `y: 0`).
Proves the hardware cursor now rides ON the input row at the composition column — the exact evidence
the OS IME acts on — under the five crash-avoidance invariants of the implementation contract
(`.design/investigations/2026-07-25-cli-062-ime-cursor-design.md`).
**Type:** agent-executable (a real pseudo-terminal drives the BUILT robota binary and a VT
interpreter reads the raw ANSI stream the way a terminal emulator does; no owner terminal smoke —
per the agent-run capability rule). The **terminal matrix is now agent-run too** — see
"Terminal matrix" below. What remains genuinely un-runnable off macOS is only the two macOS
emulators' own rendering and their OS IME (I5 keeps Apple_Terminal off by default until someone
runs the two macOS cells) — tracked in the CLI-062 backlog.

## Scenario

```bash
pnpm --filter @robota-sdk/agent-transport-tui build && pnpm --filter @robota-sdk/agent-cli build

# Unit: pure cell math (wrap-aware, wide-char straddle) + the SIGSEGV-invariant guard table.
npx vitest run packages/agent-transport-tui/src/flows/__tests__/real-cursor-flow.test.ts
# Component (interactive ink render on a fake TTY): positioned shows on the input row, CJK width
# tracking, drawn-cursor suppression, blur/unmount withdrawal, zero process-stream writes.
npx vitest run packages/agent-transport-tui/src/__tests__/real-cursor-positioning.test.tsx
# Fallback pin: capability-off rendering byte-identical to pre-change output.
npx vitest run packages/agent-transport-tui/src/__tests__/cjk-fallback-render.test.tsx
# PTY regression against the built binary (24-row: every post-boot ESC[?25h on the input row at
# the composition column; 5-row fullscreen geometry: zero shows — invariant I2).
cd packages/agent-transport-tui && npx vitest run --config vitest.pty.config.ts src/__tests__/pty/ime-cursor.ptytest.ts
```

**Expected:** every post-boot cursor show in the 24-row pty lands on the input row, final column =
prompt + `> ` (2) + `안녕` (4 display cols); zero shows in the 5-row pty; fallback frames byte-equal;
no writes to the real process streams.

## Observed (2026-07-25)

```
✓ src/flows/__tests__/real-cursor-flow.test.ts        (21 tests) — computeCursorCell table +
    shouldPositionRealCursor guard table (every false row a SIGSEGV-invariant case)
✓ src/__tests__/real-cursor-positioning.test.tsx      (3 tests)
    ✓ shows the hardware cursor on the input row at the composition column and tracks CJK growth
    ✓ I4: unfocused input never positions the cursor
    ✓ I4: blur withdraws the position and unmount leaves the cursor visible
✓ src/__tests__/cjk-fallback-render.test.tsx          (6 tests) — fallback byte-identical pin
✓ src/__tests__/pty/ime-cursor.ptytest.ts             (2 tests)
    ✓ 24-row pty: every post-boot cursor show lands on the input row at the composition column
    ✓ 5-row pty (frame ≥ viewport, I2): zero cursor-show sequences during composition

Full agent-transport-tui unit suite: 507 passed (65 files); full PTY suite: 17 passed (11 files).
```

**Red-before-green proof (anti-accidental-green, HARNESS-041):** run BEFORE the implementation
(pre-change worktree at develop `288608655` + pre-change built binary):

```
FAIL src/__tests__/real-cursor-positioning.test.tsx
  → AssertionError: expected 0 to be greater than 0   (no positioned show exists today)
FAIL src/__tests__/pty/ime-cursor.ptytest.ts > 24-row pty
  → AssertionError: expected 0 to be greater than 0   (compositionShows.length)
FAIL src/flows/__tests__/real-cursor-flow.test.ts
  → Failed to load url ../real-cursor-flow.js          (module did not exist)
```

✅ PASS — the hardware cursor is positioned via a yoga parent-chain absolute origin + ink
`useCursor` inside the synchronized frame write, guarded by I1 (measured y only), I2 (never a
frame ≥ viewport / y out of frame), I3 (no out-of-band writes), I4 (guard fail → today's drawn
cursor, byte-identical), I5 (Apple_Terminal opt-in via `ROBOTA_IME_CURSOR=1`).

## Terminal matrix (agent-run, 2026-07-26)

The backlog's remaining work was a MANUAL matrix ("iTerm2 + Terminal.app ±`ROBOTA_IME_CURSOR`,
kitty/WezTerm/Ghostty/Windows Terminal/tmux on real hardware"). It is now a re-runnable suite.

```bash
# 1. Capability half — 27 cells (9 terminals x {unset, =1, =0}) asserting supportsImeCursorPositioning().
npx vitest run packages/agent-transport-tui/src/__tests__/terminal-capabilities.test.ts
# 2. Behavioural half — the SAME 27 cells driving the BUILT binary in a real pty (24-row contract,
#    plus the 5-row I2 probe wherever the gate would otherwise allow positioning).
cd packages/agent-transport-tui && npx vitest run --config vitest.pty.config.ts src/__tests__/pty/ime-cursor.ptytest.ts
# 3. Real-emulator cell — tmux runs the binary in a real pane and reports its OWN cursor position.
cd packages/agent-transport-tui && npx vitest run --config vitest.pty.config.ts src/__tests__/pty/ime-cursor-tmux.ptytest.ts
```

**Terminal environments measured on real emulators** (launched on this machine; the env handshake is
the only channel through which an emulator's identity reaches our code):

```
Ghostty 1.3.1 (Linux/GTK4, launched under Xvfb with -e <env dump>)
  TERM=xterm-ghostty  TERM_PROGRAM=ghostty  TERM_PROGRAM_VERSION=1.3.1  COLORTERM=truecolor
GNOME Terminal 3.52.0 / VTE 0.76.0
  TERM=xterm-256color  TERM_PROGRAM=<unset>  COLORTERM=truecolor
tmux 3.4 (inside a real pane)
  TERM=tmux-256color  TERM_PROGRAM=tmux  TMUX=set
```

**Real-emulator confirmation (tmux 3.4 reporting its own cursor, `#{cursor_x} #{cursor_y} #{cursor_flag}`):**

```
24 rows, ROBOTA_IME_CURSOR unset : 7 19 1   ← visible, row 19 = the ` > 안녕` input row, col 7 = 1 + '> ' + 안녕(4)
24 rows, ROBOTA_IME_CURSOR=0     : 0 23 0   ← hidden, parked at the frame bottom (kill switch)
 5 rows, ROBOTA_IME_CURSOR unset : 8  4 0   ← hidden (I2: frame >= viewport, never positioned)
```

**Red-before-green for the matrix assertions** (each mutation applied to source, both
`agent-transport-tui` and `agent-cli` rebuilt — the CLI bundles the TUI, so rebuilding only the TUI
leaves the pty suite accidentally green):

```
Mutation A — reinstate the historical hardcoded y: 0 in useRealCursorPosition:
  FAIL real-cursor-positioning.test.tsx > SIGSEGV guard: the positioned row FOLLOWS the layout
       → AssertionError: banner=1: expected +0 to be 1
  FAIL pty/ime-cursor.ptytest.ts > Ghostty / ROBOTA_IME_CURSOR unset
       → AssertionError: expected 18 to be 19
  FAIL pty/ime-cursor-tmux.ptytest.ts > 24-row pane (tmux's own cursor readout)
       → AssertionError: expected 18 to be 19

Mutation B — capability gate reduced to `Boolean(process.stdout.isTTY)`:
  FAIL terminal-capabilities.test.ts — 12 failed / 23 passed
       (Terminal.app unset -> disabled, and every ROBOTA_IME_CURSOR=0 cell)
  FAIL pty/ime-cursor.ptytest.ts > Terminal.app (macOS) / ROBOTA_IME_CURSOR unset
       → AssertionError: expected [ …(2) ] to deeply equal []
  FAIL pty/ime-cursor.ptytest.ts > Terminal.app (macOS) / ROBOTA_IME_CURSOR=0   (same)
  FAIL pty/ime-cursor-tmux.ptytest.ts > ROBOTA_IME_CURSOR=0 kill switch
       → AssertionError: expected true to be false
```

Both mutations reverted; full suites green afterwards (555 unit tests / 49 pty tests).

**Boundary — what these cells do NOT prove.** For a `documented` profile
(`src/__tests__/helpers/terminal-profiles.ts`) the cell exercises OUR branch under the environment
that terminal exports; it says nothing about that emulator's own rendering, its inline pre-edit
display, or its OS IME. Terminal.app's historical Korean-IME SIGSEGV is an Apple-side defect and can
only be re-checked on macOS — which is why Apple_Terminal ships off by default (I5).
