---
status: review-ready
type: BEHAVIOR
tags: [cli, print-mode]
---

# CLI-038: print 모드에서 stdin pipe + positional 동시 지원

## Problem

`print-mode.ts`에서 positional 인자가 있으면 stdin을 읽지 않는다. `cat file.ts | robota -p "Review this code"` 패턴이 동작하지 않아 stdin 내용이 무시되고 `-p` 프롬프트만 처리된다. `README.md`에서 이 패턴을 예시로 제시하고 있어 문서와 구현이 불일치한다.

재현 조건: `echo "console.log('hello')" | robota -p "Review this code"` → stdin 내용 무시, 프롬프트만 전달.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/modes/print-mode.ts` — stdin + positional 동시 처리 로직

### Alternatives Considered

- **Alt A (채택): positional과 stdin을 함께 처리 — stdin을 `<stdin>` 태그로 감싸 프롬프트에 추가** — Pro: README 예시와 일치, 모델이 컨텍스트를 명확히 구분 가능. Con: 없음.
- **Alt B: positional이 있으면 stdin 무시 (현재 동작 유지)** — Pro: 구현 단순. Con: 문서와 불일치, 파이프 기반 워크플로우 불가.

### Decision

Alt A 채택. stdin과 positional을 함께 처리하되 stdin 내용을 `<stdin>` 태그로 감싸 프롬프트에 추가. 이로써 README 예시가 실제로 동작하게 됨.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — print-mode.ts, headless-e2e.test.ts 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`print-mode.ts`에서 `process.stdin.isTTY` 확인을 positional 유무와 무관하게 항상 실행. stdin 내용이 있으면 `${prompt}\n\n<stdin>\n${stdinContent}\n</stdin>` 형태로 합산.

## Affected Files

- `packages/agent-cli/src/modes/print-mode.ts`
- `packages/agent-cli/src/__tests__/headless-e2e.test.ts`

## Completion Criteria

- [ ] TC-01: `echo "code" | robota -p "Review"` 실행 → stdin 내용과 프롬프트가 모두 모델에 전달됨
- [ ] TC-02: stdin만 있는 경우(`cat file | robota -p ""`)도 동작함
- [ ] TC-03: stdin 없이 positional만 있는 경우 기존 동작 유지
- [ ] TC-04: E2E 테스트에 파이프 시나리오가 추가됨

## Test Plan

| TC-ID | Test Type | Tool / Approach                        | Notes                                             |
| ----- | --------- | -------------------------------------- | ------------------------------------------------- |
| TC-01 | unit      | vitest — print-mode stdin + positional | Mock stdin stream, verify combined prompt content |
| TC-02 | unit      | vitest — stdin-only no positional      | Empty positional, verify stdin used as prompt     |
| TC-03 | unit      | vitest — positional-only no stdin      | Mock isTTY=true, verify positional prompt only    |
| TC-04 | e2e       | vitest + child_process.spawn           | Spawn with piped stdin, verify output includes it |

## Tasks

- [ ] `.agents/tasks/CLI-038.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: BEHAVIOR` is valid (in 11-prefix list); `tags: [cli, print-mode]` present.
- Problem section: concrete symptom (`cat file.ts | robota -p "Review this code"` stdin ignored) and reproduction command (`echo "console.log('hello')" | robota -p "Review this code"`) both present; no TBD/TODO found.
- Architecture Review Checklist: all 4 items are `[x]`; sibling scan `[x]` with explicit evidence (print-mode.ts, headless-e2e.test.ts); 2 alternatives (Alt A, Alt B) each with pro/con; decision references trade-off (README alignment vs. implementation simplicity).
- Completion Criteria: 4 items, all prefixed TC-01–TC-04; observable behavior form used throughout; no vague language ("works correctly" etc.) found.
- Test Plan: section present; 4 rows matching TC-01–TC-04 (count matches Completion Criteria); all rows have non-empty Test Type and Tool/Approach; no "TBD"; no manual rows requiring Notes justification (all automated).
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` section present and was empty before this entry; no `## Status` or `## Classification` sections in body.
- TC-N count check: Completion Criteria = 4 (TC-01–TC-04), Test Plan rows = 4 (TC-01–TC-04). ✅ Match.
