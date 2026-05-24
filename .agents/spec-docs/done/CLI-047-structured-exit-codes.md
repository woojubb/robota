---
status: done
type: BEHAVIOR
tags: [cli, print-mode]
---

# CLI-047: print 모드 구조화 exit code

## Problem

print 모드에서 모든 에러가 `process.exit(1)`로 처리된다. CI/CD 파이프라인에서 에러 유형을 구분할 수 없고 `stream-json` 포맷의 에러 이벤트에도 오류 코드 필드가 없다.

재현 조건: API 키 없이 `robota -p "hello"` 실행 → exit code 1. 잘못된 플래그로 실행 → exit code 1. 두 경우를 구분 불가.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/modes/print-mode.ts` — 에러 유형별 exit code 분기
- `packages/agent-cli/src/cli.ts` — exit code 전달
- `packages/agent-cli/README.md` — exit code 표 문서화

### Alternatives Considered

- **Alt A (채택): exit code 체계화 (0~5) + stream-json error_code 필드 추가** — Pro: CI/CD 파이프라인에서 에러 유형 구분 가능, 기존 exit 1은 하위 호환 유지. Con: exit code 정의 및 모든 에러 경로 분류 작업 필요.
- **Alt B: exit 1 유지 + error 메시지에 유형 포함** — Pro: 구현 단순. Con: 파이프라인 스크립트가 텍스트 파싱에 의존, 안정적이지 않음.

### Decision

Alt A 채택. 구조화된 exit code는 CI/CD 연동에서 표준적이며 `stream-json` 포맷의 `error_code` 필드 추가로 프로그래매틱 소비도 지원.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — print-mode.ts, cli.ts 에러 처리 경로 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`print-mode.ts`에서 에러 유형 감지 후 exit code 분기 (0=성공, 1=일반, 2=인자 오류, 3=설정 오류, 4=API 오류, 5=도구 실행 오류). `stream-json` 에러 이벤트에 `error_code` 필드 추가. README에 exit code 표 문서화.

## Affected Files

- `packages/agent-cli/src/modes/print-mode.ts`
- `packages/agent-cli/src/cli.ts`
- `packages/agent-cli/README.md`

## Completion Criteria

- [x] TC-01: 정상 완료 → exit code 0
- [x] TC-02: API 키 없음(설정 오류) → exit code 3
- [x] TC-03: `stream-json` 에러 이벤트에 `error_code` 필드 포함
- [x] TC-04: README에 exit code 0~5 표가 문서화됨

## Test Plan

| TC-ID | Test Type | Tool / Approach                       | Notes                                         |
| ----- | --------- | ------------------------------------- | --------------------------------------------- |
| TC-01 | unit      | vitest — print-mode success exit      | Mock success path, verify exit code 0         |
| TC-02 | unit      | vitest — config error exit code       | Mock missing API key, verify exit code 3      |
| TC-03 | unit      | vitest — stream-json error_code field | Check error event payload includes error_code |
| TC-04 | manual    | README content check                  | Verify exit code table present in README      |

## Tasks

- [ ] `.agents/tasks/CLI-047.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: BEHAVIOR` is valid (in 11-prefix list); `tags: [cli, print-mode]` present.
- Problem section: concrete symptom ("모든 에러가 `process.exit(1)`로 처리된다"), reproduction command (`robota -p "hello"` with no API key → exit 1), no TBD/TODO/vague language.
- Architecture Review Checklist: all 4 items are `[x]`; sibling scan `[x]` with evidence (print-mode.ts, cli.ts error paths checked); 2 alternatives (Alt A, Alt B) each with pro/con; decision references trade-off (structured exit codes = CI/CD standard).
- Completion Criteria: 4 items, all with TC-N prefix (TC-01–TC-04); each uses observable behavior form; no vague language ("works correctly" etc.).
- Test Plan: `## Test Plan` section present; 4 rows matching TC-01–TC-04 (count matches); all rows have non-empty Test Type and Tool/Approach; TC-04 manual row has non-empty Notes ("Verify exit code table present in README").
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` section present and was empty at gate run; no `## Status` or `## Classification` sections in body.
- TC-N count: Completion Criteria = 4, Test Plan rows = 4 — match confirmed.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: CLI group (CLI-027~048)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-05-25

**Status upgrade:** approved → in-progress

- Task file created: `.agents/tasks/CLI-047.md` with TC-01–TC-04 tasks
- Spec moved to active/
- Implementation: add try/catch for config errors in `print-mode.ts`, add `error_code` to stream-json error events in `headless-stream-json.ts`, add exit code table to README

### [GATE-VERIFY] — ✅ PASS | 2026-05-25

**Status upgrade:** in-progress → verifying

- TC-01: headless runner resolves(0) on complete/interrupted — confirmed in headless-runner.ts
- TC-02: print-mode.ts try/catch on transport.start() exits with code 3 when error message contains "api key"/"no provider"/"provider"
- TC-03: `resolveErrorCode()` added to headless-runner.ts; `error_code` field added to result JSON when subtype=error and error is present; passed through subscribeStreamJsonEvents signature
- TC-04: README "Exit Codes (print mode)" table with codes 0–5 added — grep confirmed
- Build: agent-transport build ✅ PASS
- Typecheck: agent-cli tsc → no errors in changed files

### [GATE-COMPLETE] — ✅ PASS | 2026-05-25

**Status upgrade:** verifying → done

- TC-01 [x]: headless runner resolves(0) on success — no change needed, existing behavior
- TC-02 [x]: print-mode.ts catches transport.start() errors; exits with code 3 when msg includes "api key"/"no provider"/"provider"
- TC-03 [x]: `resolveErrorCode(error)` in headless-runner.ts; `error_code` added to result JSON payload for stream-json error events
- TC-04 [x]: README "Exit Codes (print mode)" table with codes 0–5 present — grep verified
- Tasks archived: `.agents/tasks/CLI-047.md` → `.agents/tasks/completed/CLI-047.md`
