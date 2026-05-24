---
status: review-ready
type: PERF
tags: [cli, tools, performance]
---

# CLI-042: grep-tool 파일 읽기 병렬화

## Problem

`packages/agent-tools/src/builtins/grep-tool.ts`에서 파일을 `for await` 루프로 순차적으로 읽는다. 수천 개 파일이 있는 대규모 코드베이스에서 모든 파일을 순차 처리하므로 성능 병목이 발생한다.

재현 조건: 1,000개 이상 파일이 있는 프로젝트에서 grep 도구 실행 → 단일 스레드 순차 처리로 응답 지연.

## Architecture Review

### Affected Scope

- `packages/agent-tools/src/builtins/grep-tool.ts` — p-limit 기반 병렬 처리 도입

### Alternatives Considered

- **Alt A (채택): p-limit(50)으로 동시 파일 읽기 제한** — Pro: 기존 `p-limit` 패키지 의존성 활용 가능, 메모리 사용 제어. Con: 완전 병렬 대비 약간의 오버헤드.
- **Alt B: Promise.all 무제한 병렬** — Pro: 구현 단순. Con: 1000개 파일에 1000개 동시 I/O → 메모리 폭발 위험.

### Decision

Alt A 채택. `pLimit(50)` 으로 동시 실행 수를 제한하여 I/O 효율과 메모리 안전성을 모두 확보.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — grep-tool.ts 파일 처리 루프 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`grep-tool.ts`의 순차 루프를 `p-limit(50)` 기반 `Promise.all` 로 교체. 동시 파일 읽기 수를 50개로 제한하면서 병렬 처리.

## Affected Files

- `packages/agent-tools/src/builtins/grep-tool.ts`

## Completion Criteria

- [ ] TC-01: 동시 파일 처리가 최대 50개로 제한됨 (p-limit 동작 검증)
- [ ] TC-02: 기존 grep 도구 테스트 모두 통과 (정확성 유지)
- [ ] TC-03: 병렬 처리 결과 순서가 파일명 기준으로 일관되게 정렬됨

## Test Plan

| TC-ID | Test Type | Tool / Approach                   | Notes                                           |
| ----- | --------- | --------------------------------- | ----------------------------------------------- |
| TC-01 | unit      | vitest — p-limit concurrency mock | Spy on limit fn, verify max 50 concurrent calls |
| TC-02 | unit      | vitest — existing grep tests pass | Run existing test suite, verify all pass        |
| TC-03 | unit      | vitest — result order assertion   | Check results sorted by file path               |

## Tasks

- [ ] `.agents/tasks/CLI-042.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: PERF` is valid from the 11-prefix list; `tags: [cli, tools, performance]` present.
- Problem section: concrete symptom (for-await loop in grep-tool.ts); reproduction condition (1,000+ files → sequential processing latency); no TBD/TODO/vague descriptions.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with explicit evidence ("grep-tool.ts 파일 처리 루프 확인"); 2 alternatives (Alt A p-limit, Alt B Promise.all) each with pro/con; decision cites trade-off (I/O efficiency vs. memory safety).
- Completion Criteria: 3 items, all prefixed TC-01/TC-02/TC-03; each uses observable behavior form; no vague language ("works correctly" etc.) found.
- Test Plan: section present; 3 rows matching TC-01, TC-02, TC-03; all rows have non-empty Test Type and Tool/Approach; no "TBD"; no manual rows (N/A).
- Structure: Tasks section present with placeholder; Evidence Log was empty before this entry; no `## Status` or `## Classification` body sections found.
- TC-N count check: Completion Criteria = 3 (TC-01, TC-02, TC-03); Test Plan rows = 3 — counts match.
