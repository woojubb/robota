---
id: PLG-002
title: 'Playground agent-sdk 기반 리팩토링 (WsTransport 방식)'
status: backlog
priority: medium
created: 2026-05-10
area: apps/agent-server, packages/agent-playground
---

## Background

현재 playground는 브라우저에서 직접 `Robota` 에이전트를 구성·실행하는 구조다.
`agent-cli`가 `agent-sdk + TUI` 조합인 것과 동일하게, playground는 `agent-sdk + WEB` 조합이어야 한다.

```
agent-sdk + TUI  = agent-cli   (InteractiveSession + Ink TUI)
agent-sdk + WEB  = playground  (InteractiveSession + WsTransport + browser UI)
```

## Problem

현재 구조:

```
브라우저 (agent-playground)
  → PlaygroundExecutor
    → PlaygroundAgentSession
      → Robota (agent-core) ← 브라우저에서 에이전트 실행
        → RemoteExecutor → HTTP → agent-server (단순 AI API 프록시)
```

- 브라우저가 `Robota` 에이전트를 직접 구성한다 — SDK 공개 API 우회
- `agent-server`는 AI API 단순 프록시에 불과 — `InteractiveSession` 미사용
- `RemoteExecutor` HTTP 레이어가 agent-core 내부 타입에 직접 의존

## Goal

`agent-transport-ws`를 통해 `InteractiveSession`을 브라우저에 WebSocket으로 노출한다.

목표 구조:

```
agent-server (Node.js)
  PlaygroundWebSocketServer (인증/라우팅)
    └── 연결당: InteractiveSession + createWsHandler
          └── AI Provider (Anthropic, OpenAI, Google)

브라우저 (agent-playground)
  PlaygroundWsClient (agent-transport-ws 프로토콜)
    ├── send: { type: 'submit', prompt }
    └── recv: text_delta, tool_start, tool_end, complete
          └── IConversationEvent[] → WorkflowVisualization + ChatInterface
```

## Architecture

### agent-transport-ws 프로토콜

클라이언트 → 서버:

| type     | payload              | 의미        |
| -------- | -------------------- | ----------- |
| `submit` | `{ prompt: string }` | 메시지 전송 |
| `abort`  | —                    | 실행 중단   |

서버 → 클라이언트 (실시간 이벤트):

| type         | payload                        | 의미                 |
| ------------ | ------------------------------ | -------------------- |
| `text_delta` | `{ delta: string }`            | 스트리밍 텍스트 조각 |
| `tool_start` | `{ state: IToolState }`        | 도구 호출 시작       |
| `tool_end`   | `{ state: IToolState }`        | 도구 호출 완료       |
| `thinking`   | `{ isThinking: boolean }`      | 모델 thinking 상태   |
| `complete`   | `{ result: IExecutionResult }` | 턴 완료              |
| `error`      | `{ message: string }`          | 오류                 |

## Scope

### `apps/agent-server` (수정)

- `package.json`: `@robota-sdk/agent-sdk`, `@robota-sdk/agent-transport-ws` 의존성 추가
- `websocket-server.ts`: 인증 후 연결당 `InteractiveSession` 생성 + `createWsHandler` 연결
- `app.ts`: provider 구성을 `InteractiveSession` 팩토리로 이동

### `packages/agent-playground` (교체/제거)

- `PlaygroundExecutor` → `PlaygroundWsClient` 로 교체
  - WebSocket 연결, `submit` 전송, `TServerMessage` 수신
- `PlaygroundAgentSession` 제거 (서버로 이동)
- `remote-providers.ts`, `RemoteExecutor` 의존성 제거
- `conversation-events.ts`: `TServerMessage` → `IConversationEvent[]` 변환으로 재작성
- `PlaygroundHistoryPlugin` 제거 (히스토리는 서버 관리)

### 제거되는 복잡성

- 브라우저에서 `Robota`/`agent-core` 에이전트 실행 없음
- `@robota-sdk/agent-remote-client` 의존성 제거 가능
- 브라우저 내 AI provider 구성 없음

## Session Management

- 기존 JWT 인증 유지 (`PlaygroundWebSocketServer`에 이미 구현됨)
- WebSocket 연결 1개 = `InteractiveSession` 1개
- `cwd`: 서버 프로세스 디렉토리 사용 (`process.cwd()`)
- 세션 종료: WebSocket 연결 종료 시 `session.shutdown()` 호출

## Test Plan

- [ ] `pnpm typecheck` — agent-playground가 agent-core 내부 타입을 직접 import하지 않는지 확인
- [ ] `pnpm --filter agent-playground test` — 기존 컴포넌트 테스트 통과
- [ ] `pnpm --filter agent-server test` — WebSocket + InteractiveSession 통합 테스트
- [ ] `pnpm --filter agent-web build` — 프로덕션 빌드 성공
- [ ] `pnpm harness:verify -- --scope apps/agent-web` — 하네스 검증
- [ ] `pnpm harness:verify -- --scope apps/agent-server` — 하네스 검증

## User Execution Test Scenarios

### Scenario 1: playground 대화 및 실시간 스트리밍 확인

**Prerequisites:**

- `pnpm --filter agent-web build && pnpm --filter agent-web start`
- `pnpm --filter agent-server dev`
- `ANTHROPIC_API_KEY` 또는 `OPENAI_API_KEY` 환경변수 설정

**Steps:**

1. http://localhost:3000/playground 접속
2. "안녕하세요, 간단히 자기소개 해주세요" 메시지 전송
3. 응답이 실시간으로 스트리밍되는지 확인
4. Workflow 패널에서 노드 확인

**Expected:**

- 응답 텍스트가 `text_delta` 이벤트로 실시간 스트리밍
- Chat 패널에 AI 응답 완성 후 표시
- Workflow 패널: UserMessage → AssistantResponse 노드 렌더링

### Scenario 2: 도구 호출 흐름 확인

**Prerequisites:** Scenario 1과 동일

**Steps:**

1. 도구가 등록된 상태에서 도구 사용을 유발하는 메시지 전송
2. Workflow 패널에서 도구 노드 확인

**Expected:**

- Workflow 패널: UserMessage → ToolCall → ToolResult → AssistantResponse 노드 체인

**Evidence:** (구현 후 기록)
