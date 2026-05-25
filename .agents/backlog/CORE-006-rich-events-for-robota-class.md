---
title: 'CORE-006: Robota 클래스에 이벤트 시스템 — text_delta, tool_start, tool_end'
status: todo
created: 2026-05-25
priority: medium
urgency: later
area: packages/agent-core, packages/agent-framework
depends_on: [CORE-002]
---

## Background

임베디드 앱에서 AI 실행 진행 상황을 보여주려면 두 가지 요구가 충돌한다:

- **커스텀 도구 + 이벤트 시스템**: 동시에 필요
- **현재 상태**: 커스텀 도구는 `Robota`(agent-core), 이벤트는 `InteractiveSession`(agent-framework)

CORE-002(InteractiveSession에 커스텀 도구 추가)가 완료되면 이 gap이 해소될 수 있지만,
`Robota` 클래스 자체에도 이벤트 시스템이 있으면 더 유연하다.

현재 `Robota.runStream()`은 텍스트 청크만 반환하며, 도구 실행 시작/완료 이벤트가 없다.

```typescript
// 현재
for await (const chunk of robota.runStream('What is 10+5?')) {
  process.stdout.write(chunk); // 텍스트만
}
// 도구가 호출됐는지, 언제 결과가 나왔는지 알 수 없음
```

## 목표

```typescript
// 목표 A: runStream에 구조화 이벤트 포함
for await (const event of robota.runEvents('What is 10+5?')) {
  if (event.type === 'text_delta') process.stdout.write(event.text);
  if (event.type === 'tool_start') console.log('Calling:', event.toolName);
  if (event.type === 'tool_end') console.log('Result:', event.result);
  if (event.type === 'done') console.log('Final:', event.response);
}

// 목표 B: Robota에 on/off 이벤트 리스너
robota.on('text_delta', (delta) => process.stdout.write(delta));
robota.on('tool_start', (state) => console.log(state.toolName));
await robota.run('What is 10+5?');
```

## 구현 범위

### 옵션 A — `runEvents()` AsyncIterable 추가 (권장)

```typescript
type TRobotaEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; toolName: string; input: unknown }
  | { type: 'tool_end'; toolName: string; result: unknown }
  | { type: 'done'; response: string };

// Robota 클래스에 추가
async *runEvents(prompt: string): AsyncIterable<TRobotaEvent>
```

### 옵션 B — `on()` 이벤트 리스너 추가

`Robota` 클래스에 EventEmitter 패턴 추가.

## 의존성

CORE-002가 완료되면 `InteractiveSession`에서 커스텀 도구 + 이벤트를 모두 쓸 수 있으므로
이 이슈의 우선순위는 상대적으로 낮다.

## Test Plan

- `robota.runEvents(prompt)` 호출 시 `tool_start`, `text_delta`, `done` 이벤트 순서 확인
- `pnpm test` 통과
