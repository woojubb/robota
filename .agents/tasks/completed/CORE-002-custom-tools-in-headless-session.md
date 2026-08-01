---
title: 'CORE-002: IHeadlessSessionOptions에 additionalTools 노출 — 임베디드 커스텀 도구'
status: done
done_at: 2026-05-25
pr: '610'
created: 2026-05-25
priority: critical
urgency: soon
area: packages/agent-framework
depends_on: []
---

## Background

조립 레이어(`ICreateSessionOptions`)에 `additionalTools?: IToolWithEventService[]`가
**이미 존재**한다 (`assembly/create-session.ts` line 103:
`const assembledTools = [...defaultTools, ...(options.additionalTools ?? [])]`).

그러나 **공개 API인 `IHeadlessSessionOptions`에 이 필드가 없다.**
`createAgentRuntime.createSession()` 사용자는 조립 레이어의 기능에 접근할 수 없다.

임베디드 앱(Slack 봇, Express 서버)에서 도메인 특화 도구(계산기, DB 조회 등)를
`InteractiveSession`에 추가하려면 이 기능이 반드시 노출되어야 한다.

현재:

- 커스텀 도구: `Robota`(agent-core)만 가능 → 이벤트 없음
- 이벤트 시스템: `InteractiveSession`(agent-framework)만 가능 → 커스텀 도구 없음

둘 다 동시에 쓸 방법이 없다. 이것이 임베디드 사용의 근본적 제약이다.

## 아키텍처 분석

```
agent-core      → Robota (실행 엔진)
agent-session   → Session (권한·훅·히스토리)
agent-framework → InteractiveSession (이벤트·명령·조립)
  ├─ assembly/create-session-types.ts  [ICreateSessionOptions: additionalTools 있음]
  ├─ runtime/agent-runtime.ts          [IHeadlessSessionOptions: additionalTools 없음] ← gap
  └─ interactive/interactive-session-options.ts [TInteractiveSessionOptions]
```

변경 경로:

1. `IHeadlessSessionOptions` (runtime/agent-runtime.ts) → `additionalTools` 추가
2. `createSession(opts)` 내부에서 `initOptions`에 전달
3. `initOptions` → `createInteractiveSession()` → `ICreateSessionOptions.additionalTools`

## 추가 고려: 도구 교체(replace) vs 추가(additive)

현재 `additionalTools`는 기본 8개(Bash/Read/Write...) + 추가. 임베디드 앱에서는
보안 이유로 Bash 도구를 제외하거나 CLI 도구 없이 순수 커스텀 도구만 쓰고 싶을 수 있다.

두 가지 옵션 검토:

- `additionalTools?: FunctionTool[]` — 기본 도구에 추가 (additive)
- `tools?: FunctionTool[]` — 기본 도구를 교체 (replacement, 별도 옵션)

`bare: true`와 결합해 도구 목록 제어 방식 결정 필요. 설계 컨펌 후 구현.

## 변경 범위

### 1. `IHeadlessSessionOptions` (agent-runtime.ts)

```typescript
import type { FunctionTool } from '@robota-sdk/agent-tools';

export interface IHeadlessSessionOptions {
  // ...기존...
  /** Tools to add alongside the built-in CLI tools. */
  additionalTools?: FunctionTool[];
}
```

### 2. `createSession(opts)` 내 전달

```typescript
// agent-runtime.ts createSession() 내부
return new InteractiveSession({
  // ...기존...
  additionalTools: opts.additionalTools,
});
```

### 3. `IInteractiveSessionStandardOptions` → `ICreateSessionOptions` 경로 확인

`interactive-session-init.ts`의 `initializeInteractiveSessionAsync`가
`additionalTools`를 `ICreateSessionOptions`로 전달하는지 확인·수정.

### 4. `createQuery` 동일 적용

```typescript
export interface ICreateQueryOptions {
  // ...기존...
  additionalTools?: FunctionTool[];
}
```

## Test Plan

- `createAgentRuntime.createSession({ tools: [calculatorTool] })` 생성
- `session.submit('What is 10 * 5?')` 실행 → 도구 호출 확인
- `tool_start`/`tool_end` 이벤트 발생 확인
- `pnpm typecheck && pnpm test` 통과

## User Execution Test Scenarios

### Scenario 1: 커스텀 도구 + 이벤트 동시 동작

```typescript
const session = runtime.createSession({
  permissionMode: 'bypassPermissions',
  additionalTools: [calculatorTool],
});
session.on('tool_start', (s) => console.log('tool:', s.toolName));
session.on('complete', (r) => console.log('answer:', r.response));
await session.submit('What is 10 + 20?');
// Expected: tool: calculate → answer: 30
```
