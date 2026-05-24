---
status: done
type: BEHAVIOR
tags: [cli, tools, docs]
---

# CLI-048: WebSearch BRAVE_API_KEY 없을 때 폴백 및 문서화

## Problem

`BRAVE_API_KEY`가 없으면 WebSearch 도구가 완전히 비활성화된다. README 환경변수 표에 `BRAVE_API_KEY`가 없고 내장 도구 목록에도 의존성이 명시되지 않아 사용자가 도구 활성화 조건을 알 수 없다.

재현 조건: `BRAVE_API_KEY` 없이 `robota -p "search for latest news"` → WebSearch 도구 비활성화, 사용자에게 이유 불명확.

## Architecture Review

### Affected Scope

- `packages/agent-tools/src/builtins/web-search-tool.ts` — API 키 없을 때 graceful degradation 메시지
- `packages/agent-cli/README.md` — `BRAVE_API_KEY` 환경변수 및 WebSearch 의존성 문서화

### Alternatives Considered

- **Alt A (채택): README 문서화 + API 키 없을 때 graceful degradation 메시지** — Pro: 즉각적 사용자 인지, 구현 단순, 배포 가능한 최소 대응. Con: 폴백 검색 엔진 없음.
- **Alt B: DuckDuckGo HTML 파싱 폴백 추가** — Pro: API 키 없이도 기본 검색 가능. Con: HTML 파싱은 불안정하고 유지보수 부담, CLI-048 범위 초과.

### Decision

Alt A 채택. 문서화와 graceful degradation 메시지가 P0. 폴백 검색 엔진은 별도 백로그로 분리.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — web-search-tool.ts API 키 처리 로직 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`web-search-tool.ts`에서 `BRAVE_API_KEY` 없을 때 도구 실행 시 "BRAVE_API_KEY 환경변수가 설정되지 않아 WebSearch를 사용할 수 없습니다" 메시지 반환. README 환경변수 표에 `BRAVE_API_KEY` 추가, WebSearch 도구 설명에 의존성 명시.

## Affected Files

- `packages/agent-tools/src/builtins/web-search-tool.ts`
- `packages/agent-cli/README.md`

## Completion Criteria

- [x] TC-01: `BRAVE_API_KEY` 없이 WebSearch 호출 → "API 키가 설정되지 않았습니다" 형태의 안내 메시지 반환 (에러 크래시 없음)
- [x] TC-02: README 환경변수 표에 `BRAVE_API_KEY` 항목이 추가됨
- [x] TC-03: README WebSearch 도구 설명에 `BRAVE_API_KEY` 의존성이 명시됨

## Test Plan

| TC-ID | Test Type | Tool / Approach                     | Notes                                        |
| ----- | --------- | ----------------------------------- | -------------------------------------------- |
| TC-01 | unit      | vitest — web-search missing API key | Unset BRAVE_API_KEY, verify graceful message |
| TC-02 | manual    | README content check                | Verify BRAVE_API_KEY row in env vars table   |
| TC-03 | manual    | README WebSearch section check      | Verify API key dependency documented         |

## Tasks

- [ ] `.agents/tasks/CLI-048.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: BEHAVIOR` is valid from the 11-prefix list; `tags: [cli, tools, docs]` present.
- Problem section: concrete symptom (`BRAVE_API_KEY` 없으면 WebSearch 비활성화) with specific command (`robota -p "search for latest news"`); reproduction condition explicit; no TBD/TODO/vague language.
- Architecture Review Checklist: all 4 items are `[x]`; sibling scan item `[x]` with completion evidence ("web-search-tool.ts API 키 처리 로직 확인"); Alternatives Considered has 2 entries (Alt A, Alt B) each with Pro/Con; Decision references the trade-off (P0 문서화 + graceful degradation, 폴백 검색은 별도 백로그).
- Completion Criteria: 3 items (TC-01, TC-02, TC-03) all with `TC-N` prefix; observable/command-form language; no vague phrasing ("works correctly" etc.).
- Test Plan: section present; 3 rows matching 3 TC-N entries (count matches); non-empty Test Type and Tool/Approach for all rows; manual rows (TC-02, TC-03) each have non-empty Notes explaining why.
- Structure: Tasks section present with placeholder; Evidence Log section present and was empty before this entry; no `## Status` or `## Classification` sections in body.
- TC-N count: Completion Criteria = 3 (TC-01..TC-03), Test Plan rows = 3 — counts match.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: CLI group (CLI-027~048)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-05-25

**Status upgrade:** approved → in-progress

- Task file created: `.agents/tasks/CLI-048.md` with TC-01–TC-03 tasks
- Spec moved to active/
- Implementation: TC-01 already satisfied in web-search-tool.ts; add BRAVE_API_KEY to README env vars table and WebSearch tool description

### [GATE-VERIFY] — ✅ PASS | 2026-05-25

**Status upgrade:** in-progress → verifying

- TC-01: web-search-tool.ts already returns graceful degradation JSON when BRAVE_API_KEY is unset — confirmed at lines 43–50
- TC-02: README env vars table contains `BRAVE_API_KEY` row — grep confirmed
- TC-03: README Built-in Tools table WebSearch entry updated to include "(requires BRAVE_API_KEY)"; note block added below table — grep confirmed

### [GATE-COMPLETE] — ✅ PASS | 2026-05-25

**Status upgrade:** verifying → done

- TC-01 [x]: web-search-tool.ts returns graceful JSON with error message when BRAVE_API_KEY unset — lines 43–50 confirmed
- TC-02 [x]: README env vars table row `BRAVE_API_KEY | Brave Search API key (optional — enables WebSearch tool) | WebSearch` — grep verified
- TC-03 [x]: README Built-in Tools WebSearch entry: "(requires `BRAVE_API_KEY`)" + note block below table — grep verified
- Tasks archived: `.agents/tasks/CLI-048.md` → `.agents/tasks/completed/CLI-048.md`
