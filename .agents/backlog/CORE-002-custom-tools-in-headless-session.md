---
title: 'CORE-002: createAgentRuntime 세션에 커스텀 AI 도구 지원'
status: todo
created: 2026-05-25
priority: critical
urgency: soon
area: packages/agent-framework
depends_on: []
---

## Background

현재 `createAgentRuntime.createSession()`으로 생성한 `InteractiveSession`은
AI-callable tool을 **추가할 수 없다**.

내장 CLI 도구(Bash/Read/Write/Edit/Glob/Grep/WebFetch/WebSearch)만 사용 가능하고,
커스텀 도구가 필요하면 `Robota`(agent-core)를 써야 한다.

그런데 `Robota`는:

- 이벤트 시스템 없음 (`text_delta`, `tool_start`, `tool_end` 없음)
- 세션 영속성 없음
- permission mode 없음
- 자동 컨텍스트 압축 없음

즉, **커스텀 도구 + 풍부한 세션 기능**을 동시에 쓸 방법이 없다.

이 gap은 임베디드 예제 대부분(Slack 봇, WebSocket 서버, Express API 등)에서
도메인 특화 도구를 정의할 수 없게 만들기 때문에 **critical**이다.

## 현재 상태

```typescript
// 현재: 커스텀 도구 불가
const session = runtime.createSession({
  permissionMode: 'bypassPermissions',
  // tools: [calculatorTool], ← 이 필드가 없음
});

// 현재: 커스텀 도구는 agent-core Robota로만 가능
const robota = new Robota({
  tools: [calculatorTool], // 가능하지만 이벤트 없음
});
for await (const chunk of robota.runStream(msg)) { ... } // 텍스트만 스트림
```

## 목표

```typescript
// 목표: createAgentRuntime.createSession()에 커스텀 도구 전달
import { createFunctionTool } from '@robota-sdk/agent-tools';

const calculatorTool = createFunctionTool('calculate', '...', schema, handler);

const session = runtime.createSession({
  permissionMode: 'bypassPermissions',
  tools: [calculatorTool], // ← 추가
});

session.on('tool_start', (state) => console.log('Calling:', state.toolName));
session.on('tool_end', (state) => console.log('Result:', state.toolResultData));
await session.submit('What is 5 + 3?');
```

## 구현 범위

### `IHeadlessSessionOptions`에 `tools` 필드 추가

```typescript
// packages/agent-framework/src/runtime/agent-runtime.ts
export interface IHeadlessSessionOptions {
  // ...기존 필드...
  /** Custom AI-callable tools to inject alongside the built-in tools. */
  tools?: IFunctionTool[];
}
```

### `InteractiveSession` 초기화에서 커스텀 도구 등록

- `createSession()` 내부에서 `opts.tools`를 세션 어셈블리에 전달
- 내장 도구 목록에 커스텀 도구를 추가 (or 대체)하는 방식 결정

### `createQuery`에도 `tools` 옵션 추가

```typescript
export interface ICreateQueryOptions {
  // ...기존...
  tools?: IFunctionTool[];
}
```

## Test Plan

- `createAgentRuntime.createSession({ tools: [calculatorTool] })` 로 세션 생성
- `session.submit('What is 10 * 5?')` 결과에 도구 실행 결과 포함 확인
- `tool_start`/`tool_end` 이벤트 발생 확인
- `pnpm test` 전체 통과

## User Execution Test Scenarios

### Scenario 1: 커스텀 도구가 이벤트와 함께 동작

**Steps:**

```typescript
const session = runtime.createSession({
  permissionMode: 'bypassPermissions',
  tools: [calculatorTool],
});
session.on('tool_start', (s) => console.log('tool_start:', s.toolName));
session.on('complete', (r) => console.log('response:', r.response));
await session.submit('What is 10 + 20?');
```

**Expected:**

- `tool_start: calculate` 로그 출력
- 응답에 30 포함
