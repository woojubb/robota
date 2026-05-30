---
title: 'CLI-B01: /context list — 시스템 컨텍스트 파일 미표시 및 중복 표시 버그 수정'
status: done
created: 2026-05-26
closed: 2026-05-26
priority: high
urgency: now
area: packages/agent-framework, packages/agent-command
depends_on: []
---

## Background

`/context list` 실행 시 "No context references."가 표시되지만, `/context`에서는 퍼센트(토큰 사용량)가 정상적으로 표시됨.

사용자는 토큰이 사용되고 있으면 목록에 무언가 나타날 것으로 기대하지만, 시스템 컨텍스트 파일(AGENTS.md, CLAUDE.md)이 `contextReferences` 배열에 등록되지 않아 목록에 표시되지 않았다.

## Root Cause

- 세션 시작 시 `loadContext(cwd)`가 AGENTS.md / CLAUDE.md를 로드하여 시스템 프롬프트에 포함시킴 → 토큰 사용량에 기여
- 그러나 이 파일들은 `histTracker.contextReferences`에 등록되지 않음 → `/context list`에 표시되지 않음
- `listContextReferences()`가 오직 `/context add`로 추가된 파일만 반환

## Fix

### 1. `TContextReferenceLoadType`에 `'system'` 추가

`packages/agent-framework/src/context/context-reference-inventory.ts`

- `'manual' | 'prompt-reference'` → `'manual' | 'prompt-reference' | 'system'`
- `toContextReferenceRecords()`: `'system'` 타입을 필터링하여 prompt injection에서 제외

### 2. `createSystemContextReferenceItems()` 추가

`packages/agent-framework/src/interactive/interactive-session-context-references.ts`

- `IContextFileEntry[]` → `IContextReferenceItem[]` 변환
- `loadType: 'system'`, `status: 'active'`

### 3. `SessionHistoryTracker` 확장

`packages/agent-framework/src/interactive/interactive-session-history-tracker.ts`

- `systemContextReferences` 전용 배열 추가 (별도 관리, 직렬화 제외)
- `recordSystemContextFiles(entries)` 메서드 추가
- `listContextReferences()`: 시스템 refs + 사용자 refs 합쳐서 반환 (display용)
- `listInjectionContextReferences()`: 사용자 refs만 반환 (prompt injection용)
- `clearContextReferences()`: 사용자 refs만 삭제, 시스템 refs 유지

### 4. `InteractiveSession` 연동

`packages/agent-framework/src/interactive/interactive-session.ts`

- `initializeAsync()` 완료 후 `histTracker.recordSystemContextFiles([...agentsFileEntries, ...claudeFileEntries])`
- Staleness reload 콜백에서도 동일하게 업데이트

### 5. 중복 방지: Execution Controller 분리

`packages/agent-framework/src/interactive/interactive-session-execution-controller.ts`

- `getContextReferences: () => histTracker.listInjectionContextReferences()` 로 변경
- 시스템 파일은 이미 시스템 프롬프트에 포함되어 있어서 prompt injection에서 제외
- 프롬프트 실행 후 `recordContextReferenceUsage`가 시스템 파일을 중복 추가하는 문제 해결

## Test Plan

- `pnpm --filter @robota-sdk/agent-framework typecheck` 통과
- `pnpm --filter @robota-sdk/agent-framework test` 통과 (832 tests)
- `pnpm --filter @robota-sdk/agent-command test` 통과 (168 tests)

### New Tests

- `src/interactive/__tests__/session-history-tracker-system-context.test.ts` (6 tests)
  - system refs가 `listContextReferences()`에 포함되는지
  - system refs가 user refs보다 앞에 나타나는지
  - `clearContextReferences()`가 system refs를 삭제하지 않는지
  - `listInjectionContextReferences()`가 system refs를 제외하는지 (중복 방지)
  - `recordSystemContextFiles([])`로 초기화되는지
  - reload 시 이전 system refs가 교체되는지

- `src/context/__tests__/context-command-module.test.ts` (3 tests 추가)
  - `[system, active]` 라벨로 목록에 표시되는지
  - 요약에 active count에 포함되는지
  - system ref 없을 때 "No context references." 표시되는지

## User Execution Test Scenarios

### Scenario 1: /context list에 시스템 컨텍스트 파일 표시

**Steps**:

1. AGENTS.md 또는 CLAUDE.md가 있는 프로젝트 디렉터리에서 `agent-cli` 실행
2. `/context list` 입력

**Expected**: AGENTS.md, CLAUDE.md가 `[system, active]` 라벨과 함께 목록에 표시됨

### Scenario 2: 프롬프트 입력 후 중복 없이 표시

**Steps**:

1. AGENTS.md 가 있는 프로젝트 디렉터리에서 `agent-cli` 실행
2. 프롬프트 한 번 입력
3. `/context list` 입력

**Expected**: AGENTS.md가 `[system, active]`로 한 번만 표시됨 (중복 없음)

### Scenario 3: /context clear가 시스템 파일을 삭제하지 않음

**Steps**:

1. `/context list`로 시스템 파일 확인
2. `/context clear` 실행
3. `/context list` 재확인

**Expected**: 시스템 파일은 여전히 목록에 표시됨
