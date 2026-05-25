---
title: 'CORE-005: responseFormat을 createQuery / IHeadlessSessionOptions에 노출'
status: todo
created: 2026-05-25
priority: medium
urgency: later
area: packages/agent-framework
depends_on: []
---

## Background

`IAgentConfig`(agent-core)에 `responseFormat?: IResponseFormatConfig`가 **이미 있다**:

```typescript
interface IResponseFormatConfig {
  type?: 'text' | 'json_object';
  schema?: Record<string, TConfigValue>;
}
```

그러나 이 옵션이 조립 체인을 통해 임베디드 API까지 흘러오지 않는다.

배치 처리(EX-006), 데이터 추출 파이프라인에서 AI 응답을 안정적으로 JSON으로
받으려면 `createQuery`와 `createAgentRuntime.createSession()`에서 이 옵션을
지정할 수 있어야 한다.

## 아키텍처 분석

```
agent-core         → IAgentConfig.responseFormat   ← 존재
agent-session      → Session → Robota({responseFormat}) ← 전달 가능
agent-framework    → ICreateSessionOptions          ← responseFormat 없음 (gap)
  ├─ runtime/agent-runtime.ts  IHeadlessSessionOptions   ← 없음
  └─ query.ts                  ICreateQueryOptions        ← 없음
```

체인:
`IHeadlessSessionOptions.responseFormat`
→ `IInteractiveSessionStandardOptions.responseFormat`
→ `ICreateSessionOptions.responseFormat` (assembly)
→ `Session({ responseFormat })` (agent-session)
→ `Robota({ defaultModel: { responseFormat } })` (agent-core)
→ Provider `IChatOptions.responseFormat` → API 요청

## 변경 범위

### 1. `ICreateSessionOptions` (assembly/create-session-types.ts)

```typescript
export interface ICreateSessionOptions {
  // ...기존...
  /** Request structured output from the model. */
  responseFormat?: { type: 'text' | 'json_object' };
}
```

### 2. `IHeadlessSessionOptions` (runtime/agent-runtime.ts)

```typescript
export interface IHeadlessSessionOptions {
  // ...기존...
  responseFormat?: { type: 'text' | 'json_object' };
}
```

### 3. `ICreateQueryOptions` (query.ts)

```typescript
export interface ICreateQueryOptions {
  // ...기존...
  responseFormat?: { type: 'text' | 'json_object' };
}
```

### 4. 전달 경로 구현

`assembly/create-session.ts`에서 `options.responseFormat`을
Robota 설정의 `defaultModel.responseFormat`에 주입.

## Test Plan

- `createQuery({ responseFormat: { type: 'json_object' } })` 호출
- `JSON.parse(await query('Extract...'))` 성공 확인
- `pnpm test` 통과
