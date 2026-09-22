---
title: 'SCREEN-2442: Validate Korean IME cursor positioning on macOS terminals'
issue: https://github.com/woojubb/robota/issues/2773
status: in-progress
created: 2026-09-14
priority: high
urgency: now
area: terminal UI package
depends_on: [STRUCT-012]
---

# SCREEN-2442: Validate Korean IME cursor positioning on macOS terminals

## Objective

Complete the two real macOS Korean IME cells left after CLI-062: Terminal.app default and opt-in.
Record OS, terminal and input-source versions, no-crash/position evidence, then keep or remove the
Terminal.app default-off branch based only on that evidence.

**Scope change 2026-09-22, owner decision: the two iTerm2 cells are out.** They were cells 3 and 4 —
iTerm2 default and iTerm2 with the kill switch — and neither one fed the decision this Task exists to
make. That decision is whether `supportsImeCursorPositioning` keeps its default-off branch, and the
branch is taken on `TERM_PROGRAM=Apple_Terminal` alone, so no iTerm2 observation could move it. The
2026-09-21 inventory below is left exactly as measured, iTerm2 row included: it records what was on the
machine that day and is not rewritten to match a later scope.

## Plan

- [x] TC-01 — Inventory macOS, Terminal.app, iTerm2 and enabled Korean input-source versions.
- [x] TC-01 — Execute and capture both real Terminal.app/IME cells, including mid-line composition and movement.
- [x] TC-04 — Decide and implement the Terminal.app default policy from the observed crash/position behavior.
- [ ] TC-02 and TC-03 — Rerun capability, component, fallback and PTY suites after the decision.
- [ ] TC-05 — Archive SCREEN-2442 and update the AGREEMENT-2670 projections after both user-execution gate stages pass.

## Inventory and automated baseline (2026-09-21)

Measured on the development machine, which has every component the cells need:

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
Terminal.app opt-in under invariant I5 precisely until a human observes these two cells.

**The two cells, ready to run.** In each: start the built CLI, type some ASCII, move the caret into
the middle of that text, switch to 2-Set Korean, compose a syllable there, then move the caret with the
arrow keys while composition is active. Record where the terminal draws the cursor and whether the
process survives.

| #   | Terminal     | Setting | Command                                |
| --- | ------------ | ------- | -------------------------------------- |
| 1   | Terminal.app | default | `pnpm exec robota`                     |
| 2   | Terminal.app | opt-in  | `ROBOTA_IME_CURSOR=1 pnpm exec robota` |

Both cells are the decision: if cell 2 places the cursor correctly and does not crash on this
macOS/Terminal.app pair, the I5 default-off branch has outlived its trigger and comes out; if either
misbehaves, it stays and the `docs/SPEC.md` note is updated with what was seen.

## Manual execution evidence and policy decision (2026-09-22)

The two cells were run on macOS 27.0 (build 26A428), Terminal.app 2.15 (488), with
`com.apple.inputmethod.Korean.2SetKorean`. In each cell, `hello world` was typed, the caret was moved
left five positions to the middle, Korean was selected with Ctrl+Space, and `ㅎ` + `ㅏ` + `ㄴ` was
composed without pressing Return. Left and right arrows were then sent before the TUI was exited with
Ctrl+C after restoring ABC.

| Cell | Command | Observed composition position | Movement and process result | Evidence |
| --- | --- | --- | --- | --- |
| 1, default | `pnpm exec robota` | `한` first appeared below the input line at its left edge, rather than at the mid-line composition point. | Left committed `한` between `hello ` and `world`; right moved again; `node`/`robota` remained present, so no crash. | `/tmp/robota-screen-2442-cell1-ascii-left5.png`, `/tmp/robota-screen-2442-cell1-korean-compose.png`, `/tmp/robota-screen-2442-cell1-korean-left.png`, `/tmp/robota-screen-2442-cell1-korean-right.png` |
| 2, opt-in | `ROBOTA_IME_CURSOR=1 pnpm exec robota` | `한` again first appeared below the input line at its left edge, not at the requested mid-line composition point. | Left committed `한` between `hello ` and `world`; right moved again; `node`/`robota` remained present, so no crash. | `/tmp/robota-screen-2442-cell2-ascii-left5.png`, `/tmp/robota-screen-2442-cell2-korean-compose.png`, `/tmp/robota-screen-2442-cell2-korean-left.png`, `/tmp/robota-screen-2442-cell2-korean-right.png` |

**Decision:** retain invariant I5 and the `TERM_PROGRAM === 'Apple_Terminal'` default-off branch.
The opt-in cell did not crash, but it failed the required cursor-placement half of the decision rule;
therefore removing the branch would be unsupported. The command's existing Terminal.app warning remains
applicable. No production-code change is required for the retain outcome; the package SPEC records this
real-hardware observation.

## Test Plan

Use the real built CLI in Terminal.app with Korean IME plus the existing automated environment,
component, fallback and PTY matrix. Record observable per-cell evidence rather than environment simulation alone.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 2`

### Scenario 1: Terminal.app default Korean IME cursor observation

- Executability: agent-executable
- Product surface: robota-tui
- Surface rationale: shipped-entrypoint=robota
- Prerequisites: macOS 27.0 (26A428); Terminal.app 2.15 (488); Korean 2-Set input source; Terminal Automation, Accessibility, and Screen Recording permissions; built workspace CLI; approved Bash osascript controller for Terminal and System Events; no live credential or external service.
- Command: pnpm exec robota
- Observable type: ui-state
- Observable rationale: source=rendered-product-ui
- Expected observable: visible=the Bash-run controller sends hello world, Left five times, Ctrl+Space, key codes 5/40/1, Left, and Right to the dedicated Robota TUI; 한 first renders below the input line at its left edge, then commits between hello and world, and the TUI remains live.
- Cleanup: Restore ABC input source and send Ctrl+C to exit the dedicated TUI window.
- Evidence: /tmp/robota-screen-2442-cell1-ascii-left5.png; /tmp/robota-screen-2442-cell1-korean-compose.png; /tmp/robota-screen-2442-cell1-korean-left.png; /tmp/robota-screen-2442-cell1-korean-right.png

### Scenario 2: Terminal.app opt-in Korean IME cursor observation

- Executability: agent-executable
- Product surface: robota-tui
- Surface rationale: shipped-entrypoint=robota
- Prerequisites: macOS 27.0 (26A428); Terminal.app 2.15 (488); Korean 2-Set input source; Terminal Automation, Accessibility, and Screen Recording permissions; built workspace CLI; ROBOTA_IME_CURSOR=1 exported in the dedicated Terminal shell before the product command; approved Bash osascript controller for Terminal and System Events; no live credential or external service.
- Command: pnpm exec robota
- Observable type: ui-state
- Observable rationale: source=rendered-product-ui
- Expected observable: visible=the Bash-run controller sends hello world, Left five times, Ctrl+Space, key codes 5/40/1, Left, and Right to the dedicated Robota TUI; 한 first renders below the input line at its left edge, then commits between hello and world, and the TUI remains live.
- Cleanup: Restore ABC input source and send Ctrl+C to exit the dedicated TUI window.
- Evidence: /tmp/robota-screen-2442-cell2-ascii-left5.png; /tmp/robota-screen-2442-cell2-korean-compose.png; /tmp/robota-screen-2442-cell2-korean-left.png; /tmp/robota-screen-2442-cell2-korean-right.png

### [DONE-GATE-STAGE-1] — ❌ FAIL | 2026-09-22

**Status remains:** scenario drafted
**Failed criteria:**

- Criterion 1 — complete, canonical scenario fields: `validateApplicableScenarioSection` reports
  `applicable Scenario 1: Terminal.app default Korean IME cursor observation is incomplete or
  non-canonical`; both Scenario 1 and Scenario 2 return `null` from `scenarioContract` for
  `automatable` and `manual`. Each uses an `Action:` field, which the declared contract does not
  accept. Under the declared `automatable` outcome, no supported field binds the required Terminal/IME
  interaction steps; under `manual`, the required `manual-only`, barrier, unavailable-capability,
  attempted-automation and `ui steps` fields are absent. A `doneGateStageOne` payload therefore cannot
  bind either authored scenario.
  **Required action:** Re-author both scenarios to one declared canonical outcome and field grammar,
  then rerun DONE-GATE-STAGE-1.

- Criterion 2 — executability decision: PASS as prose only — both scenarios say
  `Executability: agent-executable`; this does not cure the non-canonical scenario contracts above.
- Criterion 3 — product surface and observable: PASS as prose only — both name
  `robota-tui`, `shipped-entrypoint=robota`, canonical `pnpm exec robota`, and rendered `ui-state`
  observables rather than engineering verification. The eight referenced PNGs exist and show the
  claimed Terminal.app interaction sequence, but execution evidence cannot substitute for a written
  canonical scenario.
- Criterion 4 — credentials/external service: PASS — both prerequisites explicitly state that no live
  credential or external service is required.
- Ordering: PASS — DONE-GATE-STAGE-1 is an entry gate with no prior gate.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-22

**Status upgrade:** scenario drafted → scenario written

- Ordering: PASS — DONE-GATE-STAGE-1 is an entry gate with no prior gate.
- Field completeness: PASS — `validateApplicableScenarioSection` parses two consecutively numbered
  `automatable | 2` scenarios; each has exactly one executability, canonical product surface and
  rationale, prerequisite, command invocation, UI observable and rationale, cleanup, and evidence field.
- Scenario 1: guardian-observable-verdict=product-behavior; surface=robota-tui;
  surface-rationale=shipped-entrypoint=robota; invocation=`pnpm exec robota`;
  observable-type=ui-state; observable-rationale=source=rendered-product-ui;
  expected-observable=the dedicated Terminal.app Robota TUI renders the Korean composition/movement
  observations; executability=agent-executable.
- Scenario 2: guardian-observable-verdict=product-behavior; surface=robota-tui;
  surface-rationale=shipped-entrypoint=robota; invocation=`pnpm exec robota` with the required
  `ROBOTA_IME_CURSOR=1` prerequisite; observable-type=ui-state;
  observable-rationale=source=rendered-product-ui; expected-observable=the dedicated Terminal.app
  Robota TUI renders the Korean composition/movement observations; executability=agent-executable.
- Criterion 1: PASS — both scenarios provide an exact product command, full prerequisites, expected
  rendered-product observable, cleanup, and four nonempty screenshot evidence paths.
- Criterion 2: PASS — both scenarios explicitly declare `agent-executable`; no manual-only exception
  is claimed.
- Criterion 3: PASS — both scenarios use the canonical `robota-tui` surface and `pnpm exec robota`
  invocation, and their `ui-state` observables are rendered product behavior, not engineering output.
- Criterion 4: PASS — both prerequisites explicitly state that no live credential or external service
  is required.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: Terminal.app default Korean IME cursor observation",
      "surface": "robota-tui",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota",
      "observableType": "ui-state",
      "observable": "visible=the Bash-run controller sends hello world, Left five times, Ctrl+Space, key codes 5/40/1, Left, and Right to the dedicated Robota TUI; 한 first renders below the input line at its left edge, then commits between hello and world, and the TUI remains live.",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "macOS 27.0 (26A428); Terminal.app 2.15 (488); Korean 2-Set input source; Terminal Automation, Accessibility, and Screen Recording permissions; built workspace CLI; approved Bash osascript controller for Terminal and System Events; no live credential or external service.",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota"
      },
      "expectedObservable": "visible=the Bash-run controller sends hello world, Left five times, Ctrl+Space, key codes 5/40/1, Left, and Right to the dedicated Robota TUI; 한 first renders below the input line at its left edge, then commits between hello and world, and the TUI remains live.",
      "cleanup": "Restore ABC input source and send Ctrl+C to exit the dedicated TUI window.",
      "evidence": "/tmp/robota-screen-2442-cell1-ascii-left5.png; /tmp/robota-screen-2442-cell1-korean-compose.png; /tmp/robota-screen-2442-cell1-korean-left.png; /tmp/robota-screen-2442-cell1-korean-right.png"
    },
    {
      "name": "Scenario 2: Terminal.app opt-in Korean IME cursor observation",
      "surface": "robota-tui",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota",
      "observableType": "ui-state",
      "observable": "visible=the Bash-run controller sends hello world, Left five times, Ctrl+Space, key codes 5/40/1, Left, and Right to the dedicated Robota TUI; 한 first renders below the input line at its left edge, then commits between hello and world, and the TUI remains live.",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "macOS 27.0 (26A428); Terminal.app 2.15 (488); Korean 2-Set input source; Terminal Automation, Accessibility, and Screen Recording permissions; built workspace CLI; ROBOTA_IME_CURSOR=1 exported in the dedicated Terminal shell before the product command; approved Bash osascript controller for Terminal and System Events; no live credential or external service.",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota"
      },
      "expectedObservable": "visible=the Bash-run controller sends hello world, Left five times, Ctrl+Space, key codes 5/40/1, Left, and Right to the dedicated Robota TUI; 한 first renders below the input line at its left edge, then commits between hello and world, and the TUI remains live.",
      "cleanup": "Restore ABC input source and send Ctrl+C to exit the dedicated TUI window.",
      "evidence": "/tmp/robota-screen-2442-cell2-ascii-left5.png; /tmp/robota-screen-2442-cell2-korean-compose.png; /tmp/robota-screen-2442-cell2-korean-left.png; /tmp/robota-screen-2442-cell2-korean-right.png"
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
