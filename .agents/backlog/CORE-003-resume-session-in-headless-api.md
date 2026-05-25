---
title: 'CORE-003: IHeadlessSessionOptions에 resumeSessionId 노출 — 봇 대화 재개'
status: todo
created: 2026-05-25
priority: high
urgency: soon
area: packages/agent-framework
depends_on: []
---

## Background

Slack/Telegram/Discord 봇은 사용자가 메시지를 보낼 때마다 별도 webhook 이벤트가 들어온다.
멀티턴 대화를 유지하려면 이전 세션을 **재개(resume)** 해야 한다.

현재 `TInteractiveSessionOptions`(내부 타입)에는 `resumeSessionId`가 있으나,
`IHeadlessSessionOptions`(공개 API)에는 없다.

결과: `createAgentRuntime.createSession()`으로는 기존 대화를 재개할 수 없다.

## 현재 상태

```typescript
// 내부 타입에는 있음 (interactive-session-options.ts)
interface IInteractiveSessionStandardOptions {
  resumeSessionId?: string; // ← 있음
}

// 하지만 공개 API에는 없음
interface IHeadlessSessionOptions {
  sessionName?: string; // ← 이름 지정만 가능
  // resumeSessionId?: string; ← 없음
}
```

## 목표

```typescript
// Slack 봇 예시
const sessions = new Map<string, string>(); // threadTs → sessionId

app.event('app_mention', async ({ event, client }) => {
  const existingSessionId = sessions.get(event.thread_ts ?? event.ts);

  const session = runtime.createSession({
    permissionMode: 'bypassPermissions',
    bare: true,
    resumeSessionId: existingSessionId, // ← 재개
  });

  // 세션 완료 후 ID 저장
  session.on('complete', async (result) => {
    const sessionId = session.getSessionId?.(); // 새 세션 ID 얻기
    if (sessionId) sessions.set(event.thread_ts ?? event.ts, sessionId);
    await client.chat.postMessage({ channel: event.channel, text: result.response });
  });

  await session.submit(event.text);
});
```

## 구현 범위

### 1. `IHeadlessSessionOptions`에 `resumeSessionId` 추가

```typescript
export interface IHeadlessSessionOptions {
  // ...기존 필드...
  /** Resume an existing persisted session. Requires sessionStore to be configured. */
  resumeSessionId?: string;
}
```

### 2. `createSession()`에서 `resumeSessionId` 전달

`agent-runtime.ts`의 `createSession` 내부에서 `opts.resumeSessionId`를
`InteractiveSession` 생성자에 전달.

### 3. `getSessionId()` 공개 메서드 확인/추가

세션 생성 후 sessionId를 가져와 외부에서 저장할 수 있어야 함.

## Test Plan

1. `sessionStore`가 있는 runtime에서 세션 생성 → sessionId 저장
2. 같은 sessionId로 새 세션 생성 → 이전 대화 이어받기 확인
3. `pnpm test` 통과

## User Execution Test Scenarios

### Scenario 1: 대화 재개

**Steps:**

```typescript
const session1 = runtime.createSession({ bare: true });
await session1.submit('My name is Alice.');

const session2 = runtime.createSession({
  bare: true,
  resumeSessionId: session1Id,
});
await session2.submit('What is my name?');
// Expected: "Alice"
```
