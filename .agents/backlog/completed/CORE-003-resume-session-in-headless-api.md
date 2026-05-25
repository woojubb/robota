---
title: 'CORE-003: IHeadlessSessionOptions에 resumeSessionId 노출 — 봇 대화 재개'
status: done
done_at: 2026-05-25
pr: '610'
created: 2026-05-25
priority: high
urgency: soon
area: packages/agent-framework
depends_on: []
---

## Background

내부 타입 `TInteractiveSessionOptions`(interactive-session-options.ts)에
`resumeSessionId?: string`이 **이미 존재**한다.

그러나 **공개 API `IHeadlessSessionOptions`에 노출되지 않는다.**

Slack/Telegram/Discord 봇에서 사용자가 새 메시지를 보낼 때마다 새 session이 생성되어
이전 대화 컨텍스트가 사라진다. `resumeSessionId`를 공개하면 이 문제가 해결된다.

## 아키텍처 분석

```
agent-session   → SessionStore (파일 기반 세션 영속) — 소유자
agent-framework → InteractiveSession
  ├─ interactive-session-options.ts
  │     TInteractiveSessionOptions.resumeSessionId  ← 이미 있음
  │     IInteractiveSessionStandardOptions.resumeSessionId ← 이미 있음
  └─ runtime/agent-runtime.ts
        IHeadlessSessionOptions  ← resumeSessionId 없음 (gap)
```

`agent-session.SessionStore.load(sessionId)` 로 기존 세션을 복원하는 로직은
`interactive-session-restore.ts`에 이미 구현되어 있다.

노출만 하면 된다.

## 변경 범위 (최소)

### `IHeadlessSessionOptions` (agent-runtime.ts)

```typescript
export interface IHeadlessSessionOptions {
  // ...기존...
  /**
   * Resume an existing persisted session. Requires sessionStore to be set.
   * The session history and context are restored from the store.
   */
  resumeSessionId?: string;
}
```

### `createSession(opts)` 내 전달

```typescript
return new InteractiveSession({
  // ...기존...
  resumeSessionId: opts.resumeSessionId,
});
```

`IInteractiveSessionStandardOptions`가 이미 `resumeSessionId`를 받으므로
`InteractiveSession` 내부는 변경 불필요.

### 세션 ID 조회 API

외부에서 저장하려면 완료 후 sessionId를 알아야 한다.
`InteractiveSession`에 `getSessionId(): string | undefined` 메서드 추가 또는
`complete` 이벤트 페이로드에 `sessionId` 포함 여부 확인.

## 봇 패턴 예시 (설계 의도)

```typescript
// Slack bot: thread_ts → sessionId 매핑
const sessions = new Map<string, string>();

app.event('app_mention', async ({ event }) => {
  const runtime = createAgentRuntime({ cwd, provider });

  const threadKey = event.thread_ts ?? event.ts;
  const session = runtime.createSession({
    permissionMode: 'bypassPermissions',
    bare: true,
    sessionStore: projectStore,
    resumeSessionId: sessions.get(threadKey), // 이전 대화 재개
  });

  session.on('complete', async (result) => {
    // 세션 ID를 저장해 다음 메시지에 재사용
    const sid = session.getSessionId();
    if (sid) sessions.set(threadKey, sid);
  });

  await session.submit(event.text);
});
```

## Test Plan

- 세션 생성 → 대화 진행 → sessionId 저장
- 같은 sessionId로 새 세션 생성 (`resumeSessionId` 전달)
- 이전 대화 내용 기억 확인
- `pnpm test` 통과
