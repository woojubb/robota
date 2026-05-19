---
title: 'CORE-001: 동일 input tool call 반복 제한 (maxSameToolInputs)'
status: done
created: 2026-05-20
priority: high
urgency: now
area: packages/agent-core
depends_on: []
---

## Background

서브에이전트가 WebFetch 등의 tool을 동일한 input으로 반복 호출하는 무한루프 현상이 발생한다.
현재 `maxExecutionRounds`로 총 라운드 수는 제한할 수 있지만, 동일한 `(toolName, input)` 조합이
반복 호출되는 것을 감지하고 명확한 에러와 함께 중단하는 메커니즘이 없다.

## Goals

- 동일 `toolName + JSON.stringify(params)` 조합이 N회 초과 시 명확한 에러와 함께 실행 중단
- `IAgentConfig.maxSameToolInputs?: number` 옵션으로 설정 가능 (기본값 없음 = 제한 없음)
- 에러 메시지: `[EXECUTION] Tool "${name}" called with identical input ${N} times — aborting to prevent infinite loop`

## Scope

### 수정 파일

1. `packages/agent-core/src/interfaces/agent.ts`
   - `IAgentConfig`에 `maxSameToolInputs?: number` 추가 (Performance and limits 섹션)

2. `packages/agent-core/src/services/execution-types.ts`
   - `IExecutionContext`에 `maxSameToolInputs?: number` 추가

3. `packages/agent-core/src/services/execution-service-helpers.ts`
   - `buildFullContext()` 또는 context 빌드 시 `maxSameToolInputs` 전달

4. `packages/agent-core/src/services/execution-round-tools.ts`
   - `executeAndRecordToolCalls()` 내부에서 `roundState.sameToolInputCounts` Map을 사용해 카운트 증가
   - 한도 초과 시 throw

5. `packages/agent-core/src/services/execution-types.ts`
   - `IExecutionRoundState`에 `sameToolInputCounts: Map<string, number>` 추가

### 검증 항목

- [ ] `maxSameToolInputs: 3` 설정 시 동일 input 4번째 호출에서 에러 발생
- [ ] 에러 메시지가 명확히 표시됨
- [ ] `maxSameToolInputs` 미설정 시 기존 동작 그대로
- [ ] typecheck, lint, test 통과

## User Execution Test Scenarios

### Scenario 1: 동일 input 제한 동작 확인

1. `maxSameToolInputs: 3`으로 에이전트 생성
2. WebFetch를 동일 URL로 반복 호출하는 프롬프트 입력
3. 3회 초과 시 `[EXECUTION] Tool "WebFetch" called with identical input 4 times — aborting to prevent infinite loop` 에러 발생 확인

### Scenario 2: 미설정 시 기존 동작

1. `maxSameToolInputs` 없이 에이전트 생성
2. 동일 tool 반복 호출 — 제한 없이 `maxExecutionRounds`까지 실행됨
