---
status: review-ready
type: BEHAVIOR
tags: [cli, plugin, ecosystem]
---

# CLI-034: 공식 플러그인 1개 npm 게시 — ecosystem kickstart

## Problem

Robota SDK는 플러그인 기반 확장을 핵심 아키텍처로 내세우지만 공식 npm 플러그인이 하나도 없다. 외부 개발자가 플러그인 개발 방법을 참조할 레퍼런스가 없어 "플러그인 아키텍처"가 실제로 동작함을 증명할 수 없다.

재현 조건: `npm search @robota-sdk/plugin-` 실행 → 결과 없음.

## Architecture Review

### Affected Scope

- `packages/plugin-file-system/` — 신규 패키지 생성 (Option A 채택)
- `packages/plugin-file-system/docs/SPEC.md` — 패키지 스펙
- `apps/docs/content/` — 플러그인 개발 가이드 문서 추가

### Alternatives Considered

- **Alt A (채택): @robota-sdk/plugin-file-system** — Pro: 가장 범용적이고 구현 단순, 내부 유사 코드 재활용 가능. Con: web-search보다 임팩트 낮음.
- **Alt B: @robota-sdk/plugin-web-search** — Pro: AI 어시스턴트에서 최신 정보 검색 수요 높음. Con: 외부 API 키 필요로 설정 복잡성 증가, 첫 번째 레퍼런스로 부적합.

### Decision

Alt A 채택. 첫 공식 플러그인은 외부 의존성 없이 동작해야 "이렇게 만드는 거야"를 명확히 보여줄 수 있다. 파일 시스템 도구 모음이 가장 범용적이며 개발자 경험을 직접 보여주기 적합하다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — 기존 packages/ 구조 및 공개된 플러그인 인터페이스 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`packages/plugin-file-system/` 패키지 생성. 파일 읽기/쓰기/목록 조회 도구를 `@robota-sdk/agent-core` 플러그인 인터페이스로 구현. SPEC.md 작성, README 예제 포함, `pnpm publish:beta`로 npm 게시.

## Affected Files

- `packages/plugin-file-system/src/index.ts`
- `packages/plugin-file-system/package.json`
- `packages/plugin-file-system/docs/SPEC.md`
- `apps/docs/content/plugins/file-system.mdx`

## Completion Criteria

- [ ] TC-01: `npm install @robota-sdk/plugin-file-system` 가능 (패키지가 npm에 게시됨)
- [ ] TC-02: README 예제 코드를 그대로 실행하면 파일 읽기/쓰기가 동작함
- [ ] TC-03: docs 사이트에 플러그인 개발 가이드 페이지가 게시됨
- [ ] TC-04: `pnpm build && pnpm test` 통과

## Test Plan

| TC-ID | Test Type | Tool / Approach                    | Notes                                           |
| ----- | --------- | ---------------------------------- | ----------------------------------------------- |
| TC-01 | manual    | npm search / npm install           | Verify package is published and installable     |
| TC-02 | e2e       | vitest — example code execution    | Run README example, verify file operations work |
| TC-03 | manual    | browser — docs site page check     | Navigate to plugin guide URL, verify page loads |
| TC-04 | unit      | pnpm build && pnpm test in package | All build outputs and tests pass                |

## Tasks

- [ ] `.agents/tasks/CLI-034.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` present; `type: BEHAVIOR` is a valid type from the 11-prefix list; `tags: [cli, plugin, ecosystem]` present.
- Problem section: concrete symptom is `npm search @robota-sdk/plugin-` → 결과 없음 (specific command + output); reproduction condition stated as running the npm search command; no TBD/TODO/vague language found.
- Architecture Review Checklist: all 4 items checked `[x]`; sibling scan `[x]` with evidence "기존 packages/ 구조 및 공개된 플러그인 인터페이스 확인"; Alternatives Considered has 2 entries (Alt A, Alt B) each with explicit pro/con; Decision references the key trade-off (no external dependencies for first reference plugin).
- Completion Criteria: all 4 items have TC-N prefix (TC-01–TC-04); at least 1 criterion per feature area; all use command/observable-behavior form; no banned vague language ("works correctly", "no errors", "implemented", "displays correctly") found.
- Test Plan: `## Test Plan` section present; 4 rows match 4 TC-N entries (count matches); all rows have non-empty Test Type and Tool/Approach; manual rows TC-01 and TC-03 both have non-empty Notes entries explaining why automated testing is not possible.
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` section present and was empty before this entry; no `## Status` or `## Classification` sections found in body.
- TC-N count: Completion Criteria = 4 (TC-01–TC-04); Test Plan rows = 4 (TC-01–TC-04). Counts match ✅
