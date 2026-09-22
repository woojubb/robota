---
status: in-progress
type: SCREEN
tags: [desktop, cli, i18n]
lane: L2
---

# SCREEN-2442: Validate Terminal.app Korean IME cursor positioning

Paired with `.agents/tasks/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md`. Arising from [issue #2773](https://github.com/woojubb/robota/issues/2773).

## Problem

The shipped `robota` TUI has two unverified real Terminal.app paths: its default cursor policy and the
`ROBOTA_IME_CURSOR=1` opt-in. On macOS 27.0 with Terminal.app 2.15 and the Korean 2-Set input source,
start either product command, type `hello world`, move left five times, switch input with Ctrl+Space,
and compose `한` without Return. The wrong observable is an initial composition display below the input
line at its left edge rather than at the requested mid-line input point; whether that happens without a
crash determines whether the existing Apple_Terminal default-off branch remains necessary.

## Prior Art Research

Waived: This is a bounded real-hardware validation record for existing shipped behavior; a comparable product-design survey would not change the two measured Terminal.app cells or their evidence threshold.

## Architecture Review

### Affected Scope

- `packages/agent-ui-terminal/docs/SPEC.md` — record the real Terminal.app result beside invariant I5.
- `.agents/tasks/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md` — retain the two-cell product-execution evidence and terminal lifecycle record.
- `.agents/tasks/AGREEMENT-2670-complete-cli-and-tui-usability-accessibility-and-diagnostics.md` and its paired AGREEMENT spec — project the child Task's terminal state.

### Alternatives Considered

1. Retain the existing Apple_Terminal default-off branch and publish the real-hardware result.
   - Pro: preserves the safe default because the opt-in composition display is visibly misplaced.
   - Con: Terminal.app users who want real cursor positioning must continue to opt in.
2. Remove the default-off branch because the process did not crash and the PTY matrix reports the expected position.
   - Pro: reduces the terminal-specific exception in capability detection.
   - Con: would contradict the direct Terminal.app observation, which is the condition I5 is designed to protect.

### Decision

Choose alternative 1. The two real cells are the decision authority: both survive Korean composition and
movement, but the opt-in cell initially renders `한` below the input line at its left edge rather than
at the requested mid-line input point. Retaining I5 preserves the existing Terminal.app safety policy;
no production-code path, package boundary, or new surface changes. The affected consumer is the shipped
`robota` TUI in Terminal.app, reached by `pnpm exec robota`; the existing opt-in and warning behavior are
preserved. The adverse case is a no-crash result being mistaken for correct placement, which the recorded
mid-line screenshots rule out.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: This is a bounded real-hardware validation record for existing shipped behavior; a comparable product-design survey would not change the two measured Terminal.app cells or their evidence threshold.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Run `pnpm exec robota` and `ROBOTA_IME_CURSOR=1 pnpm exec robota` in real Terminal.app with the Korean 2-Set input source; in each cell compose `한` mid-line and move Left then Right.
2. Record the OS, Terminal.app, input-source, screenshots, process-survival result, and policy decision in the SCREEN-2442 Task.
3. Update `packages/agent-ui-terminal/docs/SPEC.md` invariant I5 with the real-hardware finding, retaining the existing default-off branch without changing production code.
4. Run the affected capability, component, fallback, and PTY suites; archive the Task and update its AGREEMENT projections after both user-execution gate stages pass.

## Affected Files

- `packages/agent-ui-terminal/docs/SPEC.md`
- `.agents/tasks/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md`
- `.agents/tasks/AGREEMENT-2670-complete-cli-and-tui-usability-accessibility-and-diagnostics.md`
- `.agents/spec-docs/draft/AGREEMENT-2670-complete-cli-and-tui-usability-accessibility-and-diagnostics.md`

## Completion Criteria

- [ ] TC-01: Both real Terminal.app cells record macOS 27.0 (26A428), Terminal.app 2.15 (488), Korean 2-Set input, mid-line `한` composition, Left/Right movement, and screenshots; the opt-in cell's initial placement is incorrect without a crash.
- [ ] TC-02: `npx vitest run src/__tests__/terminal-capabilities.test.ts src/__tests__/real-cursor-positioning.test.tsx src/__tests__/cjk-fallback-render.test.tsx` exits 0 with 46 passing tests.
- [ ] TC-03: `npx vitest run --config vitest.pty.config.ts src/__tests__/pty/ime-cursor.ptytest.ts src/__tests__/pty/ime-cursor-tmux.ptytest.ts` exits 0 with 9 passing tests.
- [ ] TC-04: I5 in `packages/agent-ui-terminal/docs/SPEC.md` records the observed incorrect opt-in placement and retains the Apple_Terminal default-off branch.
- [ ] TC-05: SCREEN-2442 is archived after both user-execution gate stages pass, and both AGREEMENT-2670 projections name its done status and completed path.

## Test Plan

| TC-ID | Test Type | Tool / Approach                             | Notes                                             |
| ----- | --------- | ------------------------------------------- | ------------------------------------------------- |
| TC-01 | Real product UI | Two dedicated Terminal.app cells with Korean 2-Set input | Screenshot and process-survival evidence, not a PTY substitute |
| TC-02 | Component/capability/fallback | Focused Vitest command | 3 files / 46 tests |
| TC-03 | PTY regression | Focused PTY Vitest command | 2 files / 9 tests |
| TC-04 | Documentation conformance | Read I5 against the real-cell outcome | Retain branch only because the opt-in placement is wrong |
| TC-05 | Lifecycle | Task archive and AGREEMENT projection checks | Both user-execution gate entries must be PASS |

## User Execution Test Scenarios

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

## Tasks

- [ ] `.agents/tasks/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md` — todo

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-09-22

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Problem section concrete symptom and reproduction condition: FAIL — `## Problem`
  says only that two Terminal.app cells must be completed and their position recorded. It does not
  state the observed wrong output (`한` initially renders below the input line at its left edge
  rather than at the mid-line composition point) or the concrete condition that produces it:
  Terminal.app with Korean 2-Set running `pnpm exec robota` or
  `ROBOTA_IME_CURSOR=1 pnpm exec robota`, after mid-line composition and arrow movement. Those
  details appear later and in the paired Task, but the GATE-WRITE criterion applies to
  `## Problem` itself.
  **Required action:** Rewrite only `## Problem` to name the wrong rendered output and its
  Terminal.app/Korean-IME command and interaction condition, then re-run GATE-WRITE.

**Other semantic criteria checked:**

- Research waiver feeding alternatives and decision: PASS — the explicit waiver establishes that
  a comparable product-design survey cannot change the two real-hardware cells or their evidence
  threshold; both alternatives and the selected decision then explicitly rely on that direct
  Terminal.app evidence.
- Decision trade-off: PASS — alternative 1 accepts continued opt-in friction to preserve the safe
  default after visibly misplaced composition; alternative 2 reduces a terminal exception but
  would contradict the observed Terminal.app behavior.
- New-surface placement: PASS (N/A) — the verified package source already owns the existing
  `TERM_PROGRAM === 'Apple_Terminal'` default-off branch and its `ROBOTA_IME_CURSOR` override.
  This document only records its hardware result and updates existing documentation/task records;
  it creates no package, app, presentation/interface, or product-family boundary.
- Completion-criteria coverage and observability: PASS — TC-01 covers the two real UI cells and
  their screenshots, TC-02 and TC-03 name exact regression commands and passing counts, TC-04
  names the observable I5 documentation outcome, and TC-05 names the task/archive and parent
  projection lifecycle state. Each is a concrete command result or observable behavior, with a
  matching Test Plan row.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `58559d6dbd7511135b4ebc14ad970dd368396276` · base `origin/develop@c8cd7ea65962c9937fc2902279fe29af49d849ec` · document `.agents/spec-docs/draft/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md` blob `ad5e6923aafa026531b072238dd92afcfe40a8f8` (untracked)

GATE VERDICT: FAIL

### [GATE-WRITE] — ✅ PASS | 2026-09-22

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering: PASS — this is the entry gate, so no prior gate record is required.
- GATE-WRITE — Concrete symptom: PASS — `## Problem` identifies the wrong rendered output as an
  initial `한` composition display below the input line at its left edge, instead of at the
  requested mid-line input point.
- GATE-WRITE — Reproduction condition: PASS — `## Problem` names macOS 27.0, Terminal.app 2.15,
  the Korean 2-Set input source, the default and `ROBOTA_IME_CURSOR=1` product paths, `hello world`,
  five Left movements, Ctrl+Space, composition without Return, and the no-crash condition.
- GATE-WRITE — Research waiver feeds alternatives and decision: PASS — the explicit waiver limits
  decision authority to the two real-hardware cells because a comparable product-design survey cannot
  change their evidence threshold; both alternatives and the selected decision apply that authority.
- GATE-WRITE — Decision trade-off: PASS — the decision keeps the safe default despite continued
  opt-in friction because a no-crash result with visibly misplaced composition is not correct
  placement; removing the exception would reduce complexity but contradict direct observation.
- GATE-WRITE — New-surface placement: PASS (N/A) — verified source already owns I5's
  `TERM_PROGRAM === 'Apple_Terminal'` default-off branch and `ROBOTA_IME_CURSOR` override. The
  change records evidence in existing documentation and task/projection records only, without a new
  package, app, presentation/interface, or layer/product-family boundary.
- GATE-WRITE — Completion-criteria coverage: PASS — TC-01 covers both real product cells;
  TC-02 and TC-03 cover focused regressions; TC-04 covers the I5 record and retained branch; TC-05
  covers archive plus AGREEMENT projections.
- GATE-WRITE — Completion-criteria observability: PASS — each TC states a concrete rendered result,
  exact command and passing count, inspectable I5 wording, or named lifecycle/path state; all five
  have matching Test Plan rows.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `58559d6dbd7511135b4ebc14ad970dd368396276` · base `origin/develop@c8cd7ea65962c9937fc2902279fe29af49d849ec` · document `.agents/spec-docs/draft/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md` blob `73d52860a1ccfbb54ab3c244d88ef159817aff71` (untracked)

GATE VERDICT: PASS

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "이거 처리 완료할 때까지 반복해서 처리 완료하고 이슈 닫아줘"
**Given:** 2026-09-22, this conversation
**Review fingerprint:** 89ae172cf49e (review 3660f29c, type/tags 92dd3530)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-22, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (89ae172cf49e) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — in this conversation, the user selected the SCREEN-2442 direct-control handoff and instructed, "이거 처리 완료할 때까지 반복해서 처리 완료하고 이슈 닫아줘". That handoff names this bounded Terminal.app validation, its completion, and issue #2773 closure; it authorises this implementation rather than a different item or a standing class.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS (N/A) — the standing approval selects the mutually exclusive DIRECT route, so no delegated approval class is asserted and the Route CLASS boundary criterion does not apply.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS (N/A) — this spec validates already-shipped Terminal.app behavior and records the result in existing documentation and Task/projection artifacts. It creates no package, app, presentation/interface surface, sibling-product dependency, or layer/product-family reclassification; the Architecture Review's new-surface checklist records the same boundary.

**Semantic criteria judged by:** independent `GATE-APPROVAL` guardian

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `58559d6dbd75` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/backlog/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md` blob `f5658a9ff428` (untracked)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-22

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 0/5 TC ids and carries 4 checkbox task(s)
  **Required action:** one task per TC-N

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `58559d6dbd75` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/todo/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md` blob `04f4c23e5746` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "이거 처리 완료할 때까지 반복해서 처리 완료하고 이슈 닫아줘"
**Given:** 2026-09-22, this conversation
**Review fingerprint:** 1636f0d9b461 (review 9c251efe, type/tags 92dd3530)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-22, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (1636f0d9b461) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `58559d6dbd75` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/todo/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md` blob `888d95646890` (untracked)

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-22

**Status remains:** approved
**Failed criteria:**

- GATE-APPROVAL — ordering: prior gate GATE-WRITE PASS and status `review-ready`: status is `approved`, `review-ready` expected
  **Required action:** run the prior gate to PASS first

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `58559d6dbd75` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/todo/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md` blob `f69e6167f141` (untracked)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-22

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: last [GATE-APPROVAL] entry is ❌ FAIL, PASS required
  **Required action:** run the prior gate to PASS first

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `58559d6dbd75` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/todo/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md` blob `e023284fca36` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "이거 처리 완료할 때까지 반복해서 처리 완료하고 이슈 닫아줘"
**Given:** 2026-09-22, this conversation
**Review fingerprint:** 1636f0d9b461 (review 9c251efe, type/tags 92dd3530)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-22, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (1636f0d9b461) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `58559d6dbd75` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/todo/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md` blob `e394a4844cf7` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-22

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-22; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 209 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 2`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md",
  "specPath": ".agents/spec-docs/todo/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 2
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md",
    ".agents/tasks/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `58559d6dbd75` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/todo/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md` blob `910d27d21f61` (modified)
