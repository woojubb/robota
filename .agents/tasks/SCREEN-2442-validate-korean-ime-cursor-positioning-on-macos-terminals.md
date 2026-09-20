---
title: 'SCREEN-2442: Validate Korean IME cursor positioning on macOS terminals'
issue: https://github.com/woojubb/robota/issues/2442
status: todo
created: 2026-09-14
priority: high
urgency: now
area: terminal UI package
depends_on: [STRUCT-012]
---

# SCREEN-2442: Validate Korean IME cursor positioning on macOS terminals

## Objective

Complete the four real macOS Korean IME cells left after CLI-062: Terminal.app default and opt-in,
iTerm2 default and disabled. Record OS, terminal and input-source versions, no-crash/position evidence,
then keep or remove the Terminal.app default-off branch based only on that evidence.

## Plan

- [x] Inventory macOS, Terminal.app, iTerm2 and enabled Korean input-source versions.
- [ ] Execute and capture all four real terminal/IME cells, including mid-line composition and movement.
- [ ] Decide and implement the Terminal.app default policy from the observed crash/position behavior.
- [ ] Rerun capability, component, fallback and PTY suites after the decision.

## Inventory and automated baseline (2026-09-21)

Measured on the development machine, which has every component the four cells need:

| Component           | Version                                                                   |
| ------------------- | ------------------------------------------------------------------------- |
| macOS               | 27.0 (build 26A428)                                                       |
| Terminal.app        | 2.15 (488)                                                                |
| iTerm2              | 3.6.8                                                                     |
| Korean input source | `com.apple.inputmethod.Korean.2SetKorean`, enabled AND currently selected |

Automated suites, run 2026-09-21 as a BASELINE, so a later red is attributable to the decision
rather than to drift. This does NOT tick the Plan's fourth item, which asks for a run AFTER the
decision — that run has not happened and cannot until the decision exists:

- `npx vitest run src/__tests__/terminal-capabilities.test.ts src/__tests__/real-cursor-positioning.test.tsx src/__tests__/cjk-fallback-render.test.tsx` → 3 files / 46 tests, exit 0
- `npx vitest run --config vitest.pty.config.ts src/__tests__/pty/ime-cursor.ptytest.ts src/__tests__/pty/ime-cursor-tmux.ptytest.ts` → 2 files / 9 tests, exit 0

**What remains is irreducibly manual, and the reason is not shyness about automation.** The behaviour
under test is Terminal.app's own handling of the cursor-report exchange while a platform IME owns the
keystrokes. A PTY supplies neither a real emulator nor a real input source; driving the IME would mean
synthesising composition events the IME itself produces, which tests the synthesiser, not the bug.
`supportsImeCursorPositioning` (`packages/agent-ui-terminal/src/terminal-capabilities.ts:32`) keeps
Terminal.app opt-in under invariant I5 precisely until a human observes these four cells.

**The four cells, ready to run.** In each: start the built CLI, type some ASCII, move the caret into
the middle of that text, switch to 2-Set Korean, compose a syllable there, then move the caret with the
arrow keys while composition is active. Record where the terminal draws the cursor and whether the
process survives.

| #   | Terminal     | Setting     | Command                                |
| --- | ------------ | ----------- | -------------------------------------- |
| 1   | Terminal.app | default     | `pnpm exec robota`                     |
| 2   | Terminal.app | opt-in      | `ROBOTA_IME_CURSOR=1 pnpm exec robota` |
| 3   | iTerm2       | default     | `pnpm exec robota`                     |
| 4   | iTerm2       | kill switch | `ROBOTA_IME_CURSOR=0 pnpm exec robota` |

Cells 1 and 2 are the decision: if 2 places the cursor correctly and does not crash on this
macOS/Terminal.app pair, the I5 default-off branch has outlived its trigger and comes out; if either
misbehaves, it stays and the `docs/SPEC.md` note is updated with what was seen.

## Test Plan

Use the real built CLI in Terminal.app and iTerm2 with Korean IME plus the existing automated environment,
component, fallback and PTY matrix. Record observable per-cell evidence rather than environment simulation alone.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: manual | 4`

Execute Terminal.app with default and `ROBOTA_IME_CURSOR=1`, then iTerm2 with default and
`ROBOTA_IME_CURSOR=0`; in each cell compose Korean mid-line and record cursor placement and crash behavior.
