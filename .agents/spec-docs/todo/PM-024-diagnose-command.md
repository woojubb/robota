---
status: approved
type: BEHAVIOR
tags: [cli, ux, diagnostics]
---

# PM-024: robota --diagnose 자가 진단 커맨드

## Problem

사용자가 설치 후 "왜 안되지?"를 혼자 디버깅하는 시간이 길다. GitHub Issues의 상당수가 "API 키 없음", "Node 버전 문제", "네트워크 접근 불가" 같은 환경 문제다. 자동 진단 커맨드가 없어 사용자가 직접 각 항목을 확인해야 한다.

재현 조건: API 키 없이 `robota` 실행 → 오류 메시지만 표시, 설정 방법 안내 없음.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/startup/diagnose-command.ts` — 진단 체크 구현
- `packages/agent-cli/src/utils/cli-args.ts` — `--diagnose` 플래그 추가

### Alternatives Considered

- **Alt A (채택): --diagnose 플래그로 체계화된 자가 진단 커맨드** — Pro: 각 항목별 ✓/✗ 표시 + 해결책 안내, 지원 비용 절감. Con: 체크 항목 유지보수 필요.
- **Alt B: 오류 발생 시에만 진단 힌트 출력** — Pro: 자동. Con: 사전 진단 불가, 복합 문제 파악 어려움.

### Decision

Alt A 채택. `--diagnose` 플래그로 Node.js 버전, 패키지 버전, API 키, 네트워크, 터미널, 설정 파일 7개 항목을 체계적으로 검사. 각 fail/warning에 해결책 URL 포함.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — diagnose-command.ts, cli-args.ts 구조 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`diagnose-command.ts`에 7개 체크 함수 구현 (Node 버전, 패키지 버전, API 키, 네트워크, 터미널, 설정 파일, 권한 모드). 30초 이내 완료. 마지막에 종합 요약 출력.

## Affected Files

- `packages/agent-cli/src/startup/diagnose-command.ts`
- `packages/agent-cli/src/utils/cli-args.ts`

## Completion Criteria

- [ ] TC-01: `robota --diagnose` 실행 → 30초 이내 모든 체크 완료
- [ ] TC-02: API 키 미설정 → "✗ ANTHROPIC_API_KEY 없음" + 설정 방법 안내
- [ ] TC-03: Node.js 버전 22 미만 → "✗ Node.js 버전" + 업그레이드 방법 안내
- [ ] TC-04: 모든 항목 통과 → "종합: 모두 정상" 출력

## Test Plan

| TC-ID | Test Type | Tool / Approach                   | Notes                                          |
| ----- | --------- | --------------------------------- | ---------------------------------------------- |
| TC-01 | unit      | vitest — diagnose all checks mock | Mock all checks, verify completes in time      |
| TC-02 | unit      | vitest — API key check fail       | Unset env var, verify ✗ + guidance message     |
| TC-03 | unit      | vitest — Node version check fail  | Mock process.version < 22, verify ✗ + guidance |
| TC-04 | unit      | vitest — all checks pass summary  | All checks pass, verify summary message        |

## Tasks

- [ ] `.agents/tasks/PM-024.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: BEHAVIOR` is valid from the 11-prefix list; `tags: [cli, ux, diagnostics]` present.
- Problem section: concrete symptom present ("API 키 없이 `robota` 실행 → 오류 메시지만 표시, 설정 방법 안내 없음"); reproduction condition stated; no TBD/TODO/vague single-sentence descriptions.
- Architecture Review Checklist: all 4 items are `[x]`; sibling scan `[x]` with evidence ("diagnose-command.ts, cli-args.ts 구조 확인"); 2 alternatives (Alt A, Alt B) each with Pro/Con; Decision references the trade-off (7 items checked, support cost reduction).
- Completion Criteria: 4 items, all with TC-N prefix (TC-01 through TC-04); each uses Observable behavior form; no vague language ("works correctly" etc.) found.
- Test Plan: section present; 4 rows matching TC-01 through TC-04 (count matches); all rows have non-empty Test Type and Tool/Approach; no "TBD" entries; no manual rows requiring Notes.
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` was empty before this entry; no `## Status` or `## Classification` sections found in body.
- TC-N count: Completion Criteria = 4 (TC-01–TC-04), Test Plan rows = 4 — counts match.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: PM group (PM-023~037)
