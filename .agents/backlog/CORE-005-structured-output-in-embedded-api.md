---
title: 'CORE-005: 임베디드 API에 구조화 출력 지원 — createQuery + JSON Schema'
status: todo
created: 2026-05-25
priority: medium
urgency: later
area: packages/agent-framework
depends_on: []
---

## Background

`Robota`(agent-core)는 `responseFormat: { type: 'json_object' }` 옵션을 지원하지만,
`createQuery`와 `createAgentRuntime.createSession()`에는 이 옵션이 없다.

배치 처리(EX-006), 데이터 추출 파이프라인 등에서는 AI 응답을 파싱 가능한 JSON으로
받는 것이 중요하다.

현재는 프롬프트에 "respond with JSON: { key: value }" 같은 설명을 넣고
`JSON.parse(response)`를 해야 하며, 파싱 실패가 빈번하다.

## 현재 상태

```typescript
// agent-core Robota: 지원함 (하지만 이벤트 시스템/세션 없음)
const robota = new Robota({
  responseFormat: { type: 'json_object' },
  ...
});

// createQuery: 지원 안 함
const query = createQuery({ provider }); // responseFormat 옵션 없음
const raw = await query('Extract keywords from: "..."'); // JSON 파싱 보장 없음
```

## 목표

```typescript
// createQuery에 responseFormat 추가
const query = createQuery({
  provider,
  responseFormat: { type: 'json_object' },
});
const result = await query('Extract name, age, email from: "Alice, 30, alice@example.com"');
const data = JSON.parse(result); // { name: "Alice", age: 30, email: "..." }
```

## 구현 범위

### `ICreateQueryOptions`에 `responseFormat` 추가

```typescript
export interface ICreateQueryOptions {
  // ...기존...
  /** Request structured JSON output from the model. */
  responseFormat?: { type: 'text' | 'json_object' };
}
```

### `IHeadlessSessionOptions`에도 추가 (선택적)

```typescript
export interface IHeadlessSessionOptions {
  // ...기존...
  responseFormat?: { type: 'text' | 'json_object' };
}
```

### 내부 전달

`InteractiveSession` → 어셈블리 레이어 → provider `IChatOptions`에 전달.

## Test Plan

- `createQuery({ responseFormat: { type: 'json_object' } })` 호출
- 결과가 유효한 JSON 문자열인지 확인
- `JSON.parse(result)` 성공 확인
- `pnpm test` 통과

## User Execution Test Scenarios

### Scenario 1: 구조화 JSON 출력

**Steps:**

```typescript
const query = createQuery({
  provider: new AnthropicProvider({ apiKey }),
  responseFormat: { type: 'json_object' },
});
const result = await query(
  'Return JSON with keys "summary" and "keywords" for: "TypeScript is a typed JavaScript."',
);
const parsed = JSON.parse(result);
console.log(parsed.summary, parsed.keywords);
```

**Expected:** `parsed.summary`와 `parsed.keywords` 정상 접근 가능
