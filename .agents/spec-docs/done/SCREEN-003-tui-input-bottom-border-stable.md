---
status: done
type: SCREEN
tags: [cli]
---

# SCREEN-003: Stabilize input bottom border during active output

## Problem

During active text output (LLM streaming response), the bottom border line of the input box (`──────`) disappears intermittently, leaving only the status bar visible below the input. The user sees 1 line instead of the expected 2 (bottom border + status bar).

Root cause: the bottom border is rendered by Ink's `<Box borderStyle="single" borderTop={false} borderLeft={false} borderRight={false}>`. Ink's Yoga layout engine can drop border characters during rapid re-renders when terminal height is fully consumed. The top border is a plain `<Text>` node (hand-drawn) and is stable; the bottom border is not.

Reproduction: `pnpm cli:dev` → submit a prompt that generates several lines of output → observe the bottom two lines.

## Architecture Review

### Affected Scope

- `packages/agent-transport-tui/src/InputArea.tsx` — replace Box `borderBottom` with a hand-drawn `<Text>` bottom border; remove all border props from the Box

### Alternatives Considered

**Alt A (chosen): Hand-draw the bottom border as `<Text>`, remove all Box border props**

- Pro: both top and bottom borders are `<Text>` nodes — same stability guarantee; Box becomes a plain layout container with no border responsibility
- Con: none; mirrors the existing top-border pattern exactly

**Alt B: Keep Box borderBottom but wrap in a fixed-height container**

- Pro: less code change
- Con: doesn't fix the root cause — Ink still renders the Box border which can drop during rapid layout recalculation; fixed-height wrappers in Yoga are error-prone

### Decision

Alt A. The top border `<Text>` pattern is already proven stable across `/resume` remounts and rapid output. Apply the same pattern to the bottom border.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: InputArea is self-contained; no sibling component reads its border dimensions
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

In `InputArea.tsx`:

1. Remove `borderStyle="single"`, `borderTop={false}`, `borderLeft={false}`, `borderRight={false}`, `borderColor={borderColor}` from the `<Box>`.
2. After the closing `</Box>`, add:
   ```tsx
   <Text color={borderColor}>{'─'.repeat(innerWidth)}</Text>
   ```

Result: both top and bottom borders are `<Text>` elements. The Box becomes a plain `paddingLeft={1}` container.

## Affected Files

- `packages/agent-transport-tui/src/InputArea.tsx`

## Completion Criteria

- [ ] TC-01 (automated, primary regression guard): rendering `InputArea` via `ink-testing-library`, the **last line** of `lastFrame()` equals `'─'.repeat(innerWidth)` (full terminal width) in BOTH the `isDisabled={true}` (streaming / "Waiting for response…") state and the idle state — locking in the structural invariant that the bottom border is an always-present `<Text>` row, not a Yoga-synthesized Box border. This is the exact regression the fix installs.
- [ ] TC-02 (manual visual confirmation): during active LLM streaming output, both the input top line (`──────`) and the bottom line (`──────`) remain visible continuously, with the status bar below the bottom border.
- [ ] TC-03: `pnpm --filter @robota-sdk/agent-transport-tui typecheck` exits 0
- [ ] TC-04: `pnpm --filter @robota-sdk/agent-transport-tui test` exits 0 with no new failures (incl. the new TC-01 test)
- [ ] TC-05: `pnpm --filter @robota-sdk/agent-transport-tui build` exits 0

## Test Plan

The fixed invariant IS deterministically assertable (per GATE-APPROVAL review): the bottom border becomes an always-present text node, so `ink-testing-library`'s `lastFrame()` can assert its presence directly — a stronger guard than a PTY streaming test (which cannot prove an intermittent flake is gone, and may pass against the old code too). The intermittent _flicker_ itself remains only manually observable; the _structural fix_ is automated.

| TC-ID | Test Type | Tool / Approach                                                                                                                            | Notes                                                                                                          |
| ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| TC-01 | automated | `ink-testing-library` `render(<InputArea …/>)` → assert last `lastFrame()` line `=== '─'.repeat(innerWidth)` in `isDisabled` + idle states | Precedent: `src/__tests__/input-area-focus-handoff.test.tsx`. Owns the bottom-border-presence regression guard |
| TC-02 | manual    | `pnpm cli:dev` + streaming response, visual inspection                                                                                     | Intermittent flicker; live confirmation only. NOT the primary guard (TC-01 is)                                 |
| TC-03 | automated | `pnpm typecheck`                                                                                                                           | Must exit 0                                                                                                    |
| TC-04 | automated | `pnpm test` (vitest)                                                                                                                       | Must pass with no regressions                                                                                  |
| TC-05 | automated | `pnpm build`                                                                                                                               | Must exit 0                                                                                                    |

## Tasks

- [ ] `.agents/tasks/SCREEN-003.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

- 2026-07-08 pre-gate — corrected stale Affected-Files path `packages/agent-transport/src/tui/InputArea.tsx`
  → real `packages/agent-transport-tui/src/InputArea.tsx`; typecheck/test/build filters likewise `-tui`.
- 2026-07-08 GATE-APPROVAL round 1 — proposal-reviewer REVISE. Design (Alt A) endorsed exactly as written
  (mechanism sound by construction: collapses the bottom border onto the proven-stable literal-text path;
  width/layout/color preserved; no sibling depends on the Box border). Required change: verification — the
  invariant IS deterministically assertable via `ink-testing-library` `lastFrame()` (spec wrongly called it
  unassertable). Added automated TC-01 as the primary regression guard; demoted visual check to TC-02.
- 2026-07-08 GATE-APPROVAL round 2 — proposal-reviewer **ENDORSE**. Verification now automated
  (`ink-testing-library` `lastFrame()` invariant), "unassertable" framing removed, filter names corrected
  and verified against package.json. Design (Alt A) re-affirmed correct by construction. Approved → implement.
- 2026-07-08 GATE-IMPLEMENT/VERIFY/COMPLETE — `InputArea.tsx`: removed all border props from the content
  `<Box>` (kept `paddingLeft={1}`), added a hand-drawn `<Text color={borderColor}>{'─'.repeat(innerWidth)}</Text>`
  after it — both top and bottom borders are now literal-text nodes. Added `input-area-bottom-border.test.tsx`
  (TC-01, 2/2): last `lastFrame()` line is a full-width `─` run equal to the top border, in `isDisabled` +
  idle states (fails if the border row is dropped). Verified: package typecheck + build EXIT 0; full suite
  418/418; TC-02 manual visual confirmation remains. DONE.
