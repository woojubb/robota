---
title: 'EX-003: WebSocket 실시간 채팅 서버 — 양방향 스트리밍'
status: done
done_at: 2026-05-25
pr: '615'
created: 2026-05-25
priority: medium
urgency: soon
area: examples/websocket-chat
depends_on: []
---

## Background

SSE는 단방향(서버→클라이언트)이다. WebSocket은 양방향으로
클라이언트가 진행 중인 응답을 중단시키거나, 동시에 여러 클라이언트가
각자의 세션을 가질 수 있음을 보여줄 수 있다.

Express SSE 예제(EX-000)와 기술적으로 다른 패턴을 보여주는 예제.

## 구현 목표

```
examples/websocket-chat/
  package.json
  tsconfig.json
  .env.example
  README.md
  src/
    server.ts    — ws WebSocket 서버 + agent-framework 세션 관리
    client.html  — 브라우저에서 바로 열 수 있는 데모 클라이언트
```

### 핵심 패턴

1. 클라이언트 연결 → 고유 세션 생성 (`createAgentRuntime`)
2. `{ type: "message", text: "..." }` 수신 → `session.submit()`
3. `text_delta` 이벤트 → `ws.send({ type: "delta", text })` 전송
4. `{ type: "abort" }` 수신 → `session.abort()` 호출
5. 연결 해제 → 세션 정리

### 보여줄 것

- 클라이언트당 독립 세션
- 실시간 토큰 스트리밍
- 응답 중단(abort) 기능
- 간단한 브라우저 클라이언트 (`client.html`)

### 기술 스택

- `ws` — WebSocket 서버
- `@robota-sdk/agent-framework` — AI 세션
- `@robota-sdk/agent-provider` — 공급자

## Test Plan

- 서버 실행 후 `client.html` 브라우저에서 열어 채팅 테스트

## User Execution Test Scenarios

### Scenario 1: 실시간 채팅 테스트

**Steps:**

1. `ANTHROPIC_API_KEY=... npm run dev`
2. 브라우저에서 `client.html` 열기
3. 메시지 전송, 스트리밍 응답 확인
4. 응답 중 "Stop" 버튼으로 중단 테스트

**Expected:** 실시간 토큰 스트리밍, 중단 동작
