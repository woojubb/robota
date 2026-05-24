---
status: review-ready
type: BEHAVIOR
tags: [cli, testing, tui]
---

# CLI-040: TUI 모드 기본 테스트 추가

## Problem

`tui-mode.ts`에 테스트가 전혀 없다. agent-cli 소스 파일 25개 중 7개만 테스트가 있어(28%) 사용자의 주 사용 경로인 대화형 TUI가 전혀 검증되지 않은 상태다. 실제 Ink 렌더링은 테스트 어렵지만 `TuiTransport` 생성 파라미터 매핑은 검증 가능하다.

재현 조건: `packages/agent-cli/src/__tests__/` 에 `tui-mode.test.ts` 없음, `pnpm test --coverage` → tui-mode.ts 커버리지 0%.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/__tests__/tui-mode.test.ts` — 신규 테스트 파일 추가

### Alternatives Considered

- **Alt A (채택): vi.spyOn으로 TuiTransport 생성자 매핑 검증** — Pro: Ink 렌더링 없이 파라미터 전달 검증 가능, 구현 단순. Con: 실제 UI 동작 검증은 불가.
- **Alt B: @testing-library/ink 기반 컴포넌트 렌더링 테스트** — Pro: 실제 UI 동작 검증. Con: 의존성 추가 필요, 테스트 설정 복잡.

### Decision

Alt A 채택. TUI 모드에서 가장 중요한 것은 옵션 매핑이 올바른지이며 vi.spyOn으로 검증 가능. 렌더링 테스트는 별도 작업으로 분리.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — tui-mode.ts, append-system-prompt.ts 구조 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`packages/agent-cli/src/__tests__/tui-mode.test.ts` 신규 작성. `vi.spyOn(TuiTransport, 'constructor')` 또는 팩토리 모킹으로 파라미터 매핑 검증. `buildAppendSystemPrompt` 로직 단위 테스트 포함.

## Affected Files

- `packages/agent-cli/src/__tests__/tui-mode.test.ts`

## Completion Criteria

- [ ] TC-01: `runTuiMode` 호출 시 `systemPrompt` 옵션이 `TuiTransport`에 올바르게 전달됨
- [ ] TC-02: `appendSystemPrompt` 옵션이 `TuiTransport`에 전달됨
- [ ] TC-03: `permissionMode`, `maxTurns` 옵션이 `TuiTransport`에 전달됨
- [ ] TC-04: `buildAppendSystemPrompt` 함수가 taskFile + jsonSchema를 올바르게 조합함
- [ ] TC-05: TUI 모드 테스트 5개 이상이 CI에서 통과함

## Test Plan

| TC-ID | Test Type | Tool / Approach                       | Notes                                          |
| ----- | --------- | ------------------------------------- | ---------------------------------------------- |
| TC-01 | unit      | vitest — TuiTransport constructor spy | Spy on constructor, verify systemPrompt passed |
| TC-02 | unit      | vitest — TuiTransport constructor spy | Verify appendSystemPrompt passed               |
| TC-03 | unit      | vitest — TuiTransport constructor spy | Verify permissionMode and maxTurns passed      |
| TC-04 | unit      | vitest — buildAppendSystemPrompt unit | Test taskFile+jsonSchema combination logic     |
| TC-05 | unit      | pnpm test — CI pass verification      | All 5+ tests in tui-mode.test.ts pass          |

## Tasks

- [ ] `.agents/tasks/CLI-040.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `status: draft` ✅, `type: BEHAVIOR` (valid from 11-prefix list) ✅, `tags: [cli, testing, tui]` ✅
- Problem section: concrete symptom (no tui-mode.test.ts, 0% coverage) ✅, reproduction condition (directory path + pnpm test --coverage command) ✅, no TBD/TODO/vague text ✅
- Architecture Review Checklist: all 4 items `[x]` ✅, sibling scan `[x]` with evidence (tui-mode.ts, append-system-prompt.ts 구조 확인) ✅
- Alternatives Considered: 2 entries (Alt A, Alt B) each with Pro/Con ✅, Decision references trade-off (option mapping is the key concern, rendering deferred) ✅
- Completion Criteria: 5 items, all with TC-01–TC-05 prefix ✅, observable/command form used, no vague language ("works correctly" etc.) ✅
- Test Plan: `## Test Plan` present ✅, 5 rows matching TC-01–TC-05 (count matches) ✅, all rows have non-empty Test Type and Tool/Approach with no TBD ✅, no manual rows requiring Notes ✅
- Structure: Tasks section present with placeholder ✅, Evidence Log present and empty before this entry ✅, no `## Status` or `## Classification` body sections ✅
- TC-N count: Completion Criteria = 5 (TC-01–TC-05), Test Plan rows = 5 — counts match ✅
