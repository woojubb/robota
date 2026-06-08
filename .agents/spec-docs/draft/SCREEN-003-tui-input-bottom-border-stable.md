---
status: draft
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

- `packages/agent-transport/src/tui/InputArea.tsx` — replace Box `borderBottom` with a hand-drawn `<Text>` bottom border; remove all border props from the Box

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

- `packages/agent-transport/src/tui/InputArea.tsx`

## Completion Criteria

- [ ] TC-01: during active LLM streaming output, both the input top line (`──────`) and the bottom line (`──────`) remain visible continuously
- [ ] TC-02: the status bar remains visible below the bottom border during active output
- [ ] TC-03: `pnpm --filter @robota-sdk/agent-transport typecheck` exits 0
- [ ] TC-04: `pnpm --filter @robota-sdk/agent-transport test` exits 0 with no new failures
- [ ] TC-05: `pnpm --filter @robota-sdk/agent-transport build` exits 0

## Test Plan

Test strategy derived from type=SCREEN, tags=[cli]: process spawn + stdout assertion.

| TC-ID | Test Type | Tool / Approach                                        | Notes                                                                         |
| ----- | --------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| TC-01 | manual    | `pnpm cli:dev` + streaming response, visual inspection | Flicker during output cannot be asserted in vitest; requires live observation |
| TC-02 | manual    | `pnpm cli:dev` + streaming response, visual inspection | Same as TC-01                                                                 |
| TC-03 | automated | `pnpm typecheck`                                       | Must exit 0                                                                   |
| TC-04 | automated | `pnpm test` (vitest)                                   | Must pass with no regressions                                                 |
| TC-05 | automated | `pnpm build`                                           | Must exit 0                                                                   |

## Tasks

- [ ] `.agents/tasks/SCREEN-003.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log
