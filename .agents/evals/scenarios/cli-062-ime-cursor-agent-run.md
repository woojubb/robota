# CLI-062 — real terminal-cursor positioning for CJK IME composition (agent-run)

**Spec:** CLI-062 (IME composition window appears at the bottom of the screen because the hardware
cursor is never positioned; the historical fix attempt SIGSEGV'd Terminal.app via a hardcoded `y: 0`).
Proves the hardware cursor now rides ON the input row at the composition column — the exact evidence
the OS IME acts on — under the five crash-avoidance invariants of the implementation contract
(`.design/investigations/2026-07-25-cli-062-ime-cursor-design.md`).
**Type:** agent-executable (a real pseudo-terminal drives the BUILT robota binary and a VT
interpreter reads the raw ANSI stream the way a terminal emulator does; no owner terminal smoke —
per the agent-run capability rule). The Terminal.app-on-real-hardware manual matrix remains open
(I5 keeps Apple_Terminal off by default until it passes) — tracked in the CLI-062 backlog.

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
