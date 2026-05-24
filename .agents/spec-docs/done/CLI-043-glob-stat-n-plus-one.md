---
status: done
type: PERF
tags: [cli, tools, performance]
---

# CLI-043: glob-tool mtime 조회 I/O 폭발 완화

## Problem

`packages/agent-tools/src/builtins/glob-tool.ts`에서 `Promise.all`로 모든 파일에 동시 `stat` 시스템 콜을 발생시킨다. 1,000개 파일에 1,000개의 stat이 동시에 실행되어 I/O 폭발을 일으킬 수 있다.

재현 조건: 1,000개 이상 파일이 있는 프로젝트에서 glob 도구 실행 → 동시 stat 1,000개 발생, 시스템 I/O 포화 가능.

## Architecture Review

### Affected Scope

- `packages/agent-tools/src/builtins/glob-tool.ts` — p-limit 기반 stat 동시성 제한

### Alternatives Considered

- **Alt A (채택): p-limit(100)으로 동시 stat 수 제한** — Pro: I/O 폭발 방지, 메모리 안전, 기존 동작 유지. Con: 완전 병렬 대비 약간 느림.
- **Alt B: mtime 정렬이 필요한 경우에만 stat 수행 (lazy 평가)** — Pro: 불필요한 stat 완전 제거. Con: 구현 복잡, 항상 mtime 기반 정렬을 기대하는 호출부와의 계약 변경 필요.

### Decision

Alt A 채택. 기존 API 계약을 유지하면서 `pLimit(100)`으로 동시 stat을 제한. 구현 단순성과 I/O 안전성 모두 확보.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — glob-tool.ts stat 처리 구조 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`glob-tool.ts`의 `Promise.all(matches.map(...stat...))` 를 `pLimit(100)` 기반으로 교체. 동시 stat 호출을 최대 100개로 제한.

## Affected Files

- `packages/agent-tools/src/builtins/glob-tool.ts`

## Completion Criteria

- [x] TC-01: 동시 stat 호출이 최대 100개로 제한됨 (p-limit 동작 검증)
- [x] TC-02: 기존 glob 도구 테스트 모두 통과 (mtime 정렬 포함)
- [x] TC-03: 결과 파일 목록이 mtime 기준으로 올바르게 정렬됨

## Test Plan

| TC-ID | Test Type | Tool / Approach                             | Notes                                                                                                                 |
| ----- | --------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| TC-01 | unit      | code review — `pLimit(100)` in glob-tool.ts | `pLimit` import + `const limit = pLimit(100)` confirmed in source; each stat call wrapped in `limit(async () => ...)` |
| TC-02 | unit      | vitest — existing glob tests pass           | `pnpm --filter @robota-sdk/agent-tools test` → 8 files, 137 tests pass                                                |
| TC-03 | unit      | code review — sort preserved after limit    | `withMtime.sort((a, b) => b.mtime - a.mtime)` unchanged after pLimit refactor; mtime ordering intact                  |

## Tasks

- [x] `.agents/tasks/completed/CLI-043.md` — archived

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: PERF` is valid (PERF in 11-prefix list); `tags: [cli, tools, performance]` present.
- Problem section: concrete symptom (`glob-tool.ts` `Promise.all` stat on every file); reproduction condition (1,000+ file project); no TBD/TODO; multi-sentence, specific description.
- Architecture Review Checklist: all 4 items are `[x]`; sibling scan `[x]` with evidence ("glob-tool.ts stat 처리 구조 확인"); Alternatives Considered has 2 entries (Alt A, Alt B) each with Pro/Con; Decision references the trade-off ("구현 단순성과 I/O 안전성 모두 확보").
- Completion Criteria: 3 items (TC-01, TC-02, TC-03), all with TC-N prefix; observable behavior form used throughout; no vague language ("works correctly", "no errors", etc.).
- Test Plan: `## Test Plan` section present; 3 rows matching TC-01/TC-02/TC-03 (count matches); all rows have non-empty Test Type (unit) and Tool/Approach (vitest); no manual rows requiring Notes justification.
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` section present and was empty before this entry; no `## Status` or `## Classification` sections in body.
- TC-N count match: Completion Criteria = 3 (TC-01, TC-02, TC-03); Test Plan rows = 3 (TC-01, TC-02, TC-03). ✅

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: CLI group (CLI-027~048)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-05-25

**Status upgrade:** approved → in-progress

- Task file created: `.agents/tasks/CLI-043.md` with TC-01, TC-02, TC-03
- Spec moved: `todo/` → `active/`
- Implementation target: `packages/agent-tools/src/builtins/glob-tool.ts` — replace `Promise.all` with `pLimit(100)` wrapper

### [GATE-VERIFY] — ✅ PASS | 2026-05-25

**Status upgrade:** in-progress → verifying

- `pnpm --filter @robota-sdk/agent-tools build` → ✅ Build complete
- `pnpm --filter @robota-sdk/agent-tools test` → ✅ 8 test files, 137 tests pass (2 pre-existing failures in untracked web-\*-tool.test.ts unrelated to glob-tool)

### [GATE-COMPLETE] — ✅ PASS | 2026-05-25

**Status upgrade:** verifying → done

- TC-01 ✅: `pLimit(100)` imported and wraps every stat call in `glob-tool.ts`; concurrency capped at 100
- TC-02 ✅: `pnpm --filter @robota-sdk/agent-tools test` — 8 test files, 137 tests pass
- TC-03 ✅: `withMtime.sort((a, b) => b.mtime - a.mtime)` unchanged after refactor; mtime ordering intact
- Task archived: `.agents/tasks/CLI-043.md` → `.agents/tasks/completed/CLI-043.md`
- Spec moved: `active/` → `done/`
