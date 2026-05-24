---
status: review-ready
type: BEHAVIOR
tags: [cli, testing]
---

# CLI-041: diagnose, init, web-fetch, web-search 테스트 커버리지

## Problem

핵심 기능 4개 파일에 테스트가 전혀 없다: `diagnose-command.ts`(Node 버전/API 키/네트워크 체크), `init-command.ts`(Claude Code 마이그레이션), `web-fetch-tool.ts`(에러 분류), `web-search-tool.ts`(에러 처리). agent-cli 전체 커버리지가 28%에 머물러 있다.

재현 조건: `pnpm test --coverage` → `diagnose-command.ts`, `init-command.ts`, `web-fetch-tool.ts`, `web-search-tool.ts` 커버리지 0%.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/__tests__/diagnose-command.test.ts` — 신규 테스트
- `packages/agent-cli/src/__tests__/init-command.test.ts` — 신규 테스트
- `packages/agent-tools/src/__tests__/web-fetch-tool.test.ts` — 신규 테스트
- `packages/agent-tools/src/__tests__/web-search-tool.test.ts` — 신규 테스트

### Alternatives Considered

- **Alt A (채택): 4개 파일 각각 단위 테스트 추가** — Pro: 파일별 독립 검증, 커버리지 목표(50%) 달성. Con: 테스트 파일 4개 신규 추가.
- **Alt B: 통합 테스트로 간접 커버** — Pro: 적은 파일 수. Con: 실패 지점 특정 어렵고 개별 에러 케이스 검증 불가.

### Decision

Alt A 채택. 각 파일의 에러 케이스가 명확히 다르므로 단위 테스트가 적합. 커버리지 28% → 50% 이상 목표.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — 4개 파일의 기존 구조 및 에러 경로 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

각 파일별 테스트 파일 신규 작성. `diagnose-command.ts`의 각 check 함수, `init-command.ts`의 Claude 마이그레이션 경로, `web-fetch-tool.ts`의 `classifyFetchError`, `web-search-tool.ts`의 API 키 없는 케이스 검증.

## Affected Files

- `packages/agent-cli/src/__tests__/diagnose-command.test.ts`
- `packages/agent-cli/src/__tests__/init-command.test.ts`
- `packages/agent-tools/src/__tests__/web-fetch-tool.test.ts`
- `packages/agent-tools/src/__tests__/web-search-tool.test.ts`

## Completion Criteria

- [ ] TC-01: `diagnose-command.ts` 관련 테스트 5개 이상 통과 (Node 버전, API 키, 터미널 감지 등)
- [ ] TC-02: `init-command.ts` Claude Code 마이그레이션 경로 테스트 통과
- [ ] TC-03: `web-fetch-tool.ts`의 `classifyFetchError` 에러 분류 테스트 통과
- [ ] TC-04: `web-search-tool.ts` API 키 없는 케이스 + 네트워크 에러 처리 테스트 통과
- [ ] TC-05: `pnpm test --coverage` → agent-cli 전체 커버리지 50% 이상

## Test Plan

| TC-ID | Test Type | Tool / Approach                           | Notes                                            |
| ----- | --------- | ----------------------------------------- | ------------------------------------------------ |
| TC-01 | unit      | vitest — diagnose-command check functions | Mock process.version, env vars, network          |
| TC-02 | unit      | vitest — init-command migration path      | Mock fs, verify AGENTS.md and settings migration |
| TC-03 | unit      | vitest — classifyFetchError unit          | Various error types → correct classification     |
| TC-04 | unit      | vitest — web-search error handling        | Mock fetch failure, verify error message         |
| TC-05 | unit      | pnpm test --coverage threshold check      | Coverage report shows ≥50% for agent-cli         |

## Tasks

- [ ] `.agents/tasks/CLI-041.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: BEHAVIOR` is valid (in 11-prefix list); `tags: [cli, testing]` present.
- Problem section: concrete symptom identified (4 files at 0% coverage, overall 28%); reproduction condition provided (`pnpm test --coverage`); no "TBD"/"TODO" or vague single-sentence descriptions.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with evidence ("4개 파일의 기존 구조 및 에러 경로 확인"); 2 alternatives (Alt A, Alt B) each with pro/con; decision references trade-off ("각 파일의 에러 케이스가 명확히 다르므로 단위 테스트가 적합").
- Completion Criteria: 5 items, all with TC-N prefix (TC-01–TC-05); each uses observable/measurable form; no forbidden vague language.
- Test Plan: `## Test Plan` section present; 5 rows matching 5 TC-Ns — count matches; all rows have non-empty Test Type and Tool/Approach; no "TBD"; no manual-only rows requiring Notes justification.
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` section present and was empty before this entry; no `## Status` or `## Classification` sections in body.
