---
title: 'CORE-006: [WITHDRAWN] Robota 클래스 이벤트 — 레이어 위반으로 철회'
status: rejected
created: 2026-05-25
rejected_at: 2026-05-25
reason: architecture-violation
area: packages/agent-core
depends_on: []
---

## 철회 이유

`Robota`(agent-core)에 `text_delta`, `tool_start`, `tool_end` 이벤트를 추가하는 것은
레이어 위반이다.

아키텍처 분석:

```
agent-core (Robota)       = 실행 엔진. 이벤트 시스템 없음 — 의도적 설계
agent-session (Session)   = 권한·훅·히스토리. 실행 결과를 Session 경계 내에서 관리
agent-framework (InteractiveSession) = 이벤트 facade. text_delta/tool_start 등 발행
```

이벤트 시스템은 `InteractiveSession`(agent-framework)의 책임이다.
`Robota`에 이 책임을 추가하면 agent-core에 framework 관심사가 침투한다.

## 올바른 해결책: CORE-002

`InteractiveSession`이 커스텀 도구(`additionalTools`)를 받도록 하면
"커스텀 도구 + 이벤트 시스템"을 동시에 사용할 수 있다.

```typescript
// CORE-002 완료 후
const session = runtime.createSession({
  additionalTools: [calculatorTool], // ← CORE-002
  permissionMode: 'bypassPermissions',
});
session.on('tool_start', (s) => ...);  // ← 이미 존재
session.on('text_delta', (t) => ...);  // ← 이미 존재
await session.submit('What is 10+5?');
```

이것이 정확한 레이어 배분이다. CORE-002를 우선 구현한다.
