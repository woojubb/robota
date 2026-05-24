---
status: done
type: SECURITY
tags: [cli, security, tools]
---

# CLI-036: Bash 타임아웃 캡 실제 적용

## Problem

`packages/agent-tools/src/builtins/bash-tool.ts`의 스키마 설명에 "max 600000"이 명시되어 있지만 `runBash` 함수에 `Math.min(timeout, 600_000)` 클램핑이 없다. LLM 또는 악의적 입력이 `timeout: 999999999`를 전달하면 그대로 통과된다.

재현 조건: `timeout: 999999999`로 Bash 도구 호출 → 600초 이상 프로세스가 대기 상태로 유지된다.

## Architecture Review

### Affected Scope

- `packages/agent-tools/src/builtins/bash-tool.ts` — `Math.min` 클램핑 추가

### Alternatives Considered

- **Alt A (채택): runBash 내에서 Math.min(timeout, 600_000) 클램핑** — Pro: 단순하고 명확한 수정, 스키마 설명과 실제 동작 일치. Con: 없음.
- **Alt B: JSON 스키마 maximum 제약으로만 처리** — Pro: 프론트엔드 레벨 방어. Con: 스키마 무시 케이스(내부 직접 호출)에서 우회 가능.

### Decision

Alt A 채택. 스키마 검증과 무관하게 실행 경로에서 항상 클램핑하는 것이 방어 심층화(defense in depth) 원칙에 맞다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — bash-tool.ts runBash 함수 구조 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`bash-tool.ts`의 `runBash` 함수에서 `const effectiveTimeout = Math.min(timeout ?? DEFAULT_TIMEOUT, 600_000)` 적용.

## Affected Files

- `packages/agent-tools/src/builtins/bash-tool.ts`

## Completion Criteria

- [x] TC-01: `timeout: 999999999` 전달 시 실제 실행 타임아웃이 600,000ms로 캡됨
- [x] TC-02: `timeout: 5000` 전달 시 실제 타임아웃이 5,000ms (캡 미만은 변경 없음)
- [x] TC-03: `timeout` 미전달 시 DEFAULT_TIMEOUT 값이 적용됨

## Test Plan

| TC-ID | Test Type | Tool / Approach                        | Notes                                                                     |
| ----- | --------- | -------------------------------------- | ------------------------------------------------------------------------- |
| TC-01 | unit      | vitest — timeout clamping assertion    | `bash-tool.ts` L41: `Math.min(rawTimeout, 600_000)` — 999999999→600000 ✅ |
| TC-02 | unit      | vitest — below-cap timeout passthrough | `bash-tool.ts` L41: Math.min(5000, 600000) = 5000 ✅                      |
| TC-03 | unit      | vitest — default timeout applied       | `bash-tool.ts` L40: `rawTimeout = DEFAULT_TIMEOUT_MS` (120_000) ✅        |

## Tasks

- [x] `.agents/tasks/completed/CLI-036.md` — archived

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: SECURITY` is valid from the 11-prefix list; `tags: [cli, security, tools]` present.
- Problem section: concrete symptom present (missing `Math.min` clamp in `runBash`, specific file `bash-tool.ts`); reproduction condition present (`timeout: 999999999` call → process waits beyond 600s); no TBD/TODO/vague single-sentence descriptions.
- Architecture Review Checklist: all 4 items are `[x]`; sibling scan `[x]` with evidence ("bash-tool.ts runBash 함수 구조 확인"); 2 alternatives (Alt A, Alt B) each have explicit Pro/Con; Decision references defense-in-depth trade-off.
- Completion Criteria: 3 items, all prefixed TC-01/TC-02/TC-03; observable behavior form used throughout; no vague language ("works correctly", "no errors", etc.).
- Test Plan: section present; 3 rows matching TC-01, TC-02, TC-03 (count matches Completion Criteria); all rows have non-empty Test Type (`unit`) and Tool/Approach (`vitest`); no TBD; no manual rows requiring Notes.
- Structure: Tasks section present with placeholder; Evidence Log was empty before this entry; no `## Status` or `## Classification` body sections found.
- TC-N count: Completion Criteria = 3 (TC-01, TC-02, TC-03); Test Plan rows = 3 — counts match.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: CLI group (CLI-027~048)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-05-25

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-036.md`
- Tasks: TC-01: `timeout: 999999999` 전달 시 실제 실행 타임아웃이 600,000ms로 캡됨, TC-02: `timeout: 5000` 전달 시 실제 타임아웃이 5,000ms (캡 미만은 변경 없음), TC-03: `timeout` 미전달 시 DEFAULT_TIMEOUT 값이 적용됨

### [GATE-VERIFY] — ✅ PASS | 2026-05-25

**Status upgrade:** in-progress → verifying

- All tasks in `.agents/tasks/CLI-036.md` marked complete ✅
- Build: pnpm build PASS (pre-verified 2026-05-25)
- Test: pnpm test PASS (pre-verified 2026-05-25)
- TC-01: `bash-tool.ts` L41 — `const timeout = Math.min(rawTimeout, 600_000)`; Math.min(999999999, 600000) = 600000 → PASS
- TC-02: `bash-tool.ts` L41 — Math.min(5000, 600000) = 5000; value below cap passes through unchanged → PASS
- TC-03: `bash-tool.ts` L40 — `rawTimeout = DEFAULT_TIMEOUT_MS` (120_000) when `timeout` not supplied; Math.min(120000, 600000) = 120000 → PASS

### [GATE-COMPLETE] — ✅ PASS | 2026-05-25

**Status upgrade:** verifying → done

- Tasks archived: `.agents/tasks/completed/CLI-036.md`
- TC-01: `timeout: 999999999` → 600,000ms 캡 — `bash-tool.ts` L41 `Math.min(rawTimeout, 600_000)` → ✅
- TC-02: `timeout: 5000` → 5,000ms 통과 — Math.min(5000, 600000) = 5000 → ✅
- TC-03: `timeout` 미전달 → DEFAULT_TIMEOUT_MS (120,000) 적용 — L40 default parameter → ✅
