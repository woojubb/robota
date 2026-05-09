---
id: PLG-002
title: 'agent-cli 보조 브라우저 모니터 (CLI Second Screen)'
status: backlog
priority: medium
created: 2026-05-10
area: packages/agent-cli, packages/agent-transport-ws, apps/agent-web, packages/agent-playground
---

## Vision

터미널에서 `agent-cli`를 실행하는 사용자가 보조 모니터로 브라우저를 열어 실행 현황을 실시간으로 시각화한다.
입력은 CLI, 시각화는 브라우저. 두 화면이 하나의 `InteractiveSession`을 공유한다.

```
사용자
  ├── 터미널: agent-cli (입력 + TUI)
  │     └── InteractiveSession
  │           └── createWsTransport → WS 서버 (사이드카, 선택적)
  └── 브라우저: agent-web/playground (읽기 전용 보조 화면)
        └── WS 연결 → text_delta, tool_start, tool_end, complete 수신
              └── WorkflowVisualization + 대화 복원
```

## Background

`agent-cli`는 `agent-sdk + TUI` 조합이다. `agent-transport-ws`는 `InteractiveSession`을 WebSocket으로 노출하는 표준 어댑터로 이미 존재한다. 두 가지를 결합하면 CLI 세션을 브라우저에서 관찰할 수 있다.

브라우저는 **보조 화면**으로, 입력 기능이 없고 에이전트 실행도 없다. 기존 `agent-playground`의 `PlaygroundExecutor` 구조(브라우저에서 직접 에이전트 구성·실행)와 완전히 다른 방향이다.

## Architecture

### agent-cli 측 (사이드카 서버)

`agent-cli`가 `--web` 또는 `--web-port <port>` 플래그를 받으면:

1. 지정 포트에 HTTP + WebSocket 서버를 로컬로 시작
2. 기존 `InteractiveSession`에 `createWsTransport` 연결
3. 브라우저가 `ws://localhost:<port>` 로 접속하면 세션 이벤트 스트리밍 시작

```typescript
// agent-cli 내부 (개념)
const session = new InteractiveSession({ cwd, provider });
const transport = createWsTransport({ send: (msg) => ws.send(JSON.stringify(msg)) });
transport.attach(session);
await transport.start();
```

### 브라우저 측 (읽기 전용 클라이언트)

`agent-web`에 `/monitor` 또는 `/session` 페이지를 추가:

1. 로컬 포트(`ws://localhost:<port>`)에 WebSocket 연결
2. `TServerMessage` 이벤트 수신하여 대화 상태 복원:
   - `text_delta` → 스트리밍 텍스트 누적
   - `tool_start` / `tool_end` → 도구 호출 상태 추적
   - `complete` → 턴 완료, 메시지 확정
3. `IConversationEvent[]` 로 변환 → `WorkflowVisualization` 렌더링
4. 입력 UI 없음 — 관찰 전용

### 프로토콜 (agent-transport-ws 기존 정의 그대로)

서버 → 클라이언트 (CLI 세션 이벤트 중계):

| type         | payload                        | 의미                 |
| ------------ | ------------------------------ | -------------------- |
| `text_delta` | `{ delta: string }`            | 스트리밍 텍스트 조각 |
| `tool_start` | `{ state: IToolState }`        | 도구 호출 시작       |
| `tool_end`   | `{ state: IToolState }`        | 도구 호출 완료       |
| `thinking`   | `{ isThinking: boolean }`      | 모델 thinking 상태   |
| `complete`   | `{ result: IExecutionResult }` | 턴 완료              |
| `error`      | `{ message: string }`          | 오류                 |
| `messages`   | `{ messages: [...] }`          | 전체 대화 히스토리   |

## Scope

### `packages/agent-cli` (수정)

- `--web` / `--web-port <port>` CLI 플래그 추가 (기본값: 비활성)
- 플래그 활성 시: 로컬 HTTP + WebSocket 서버 시작
- `createWsTransport` 를 `InteractiveSession` 에 연결
- TUI 하단에 "브라우저 모니터: http://localhost:\<port\>" 안내 표시

### `packages/agent-transport-ws` (변경 없음)

- 기존 `createWsTransport` / `createWsHandler` 그대로 사용

### `apps/agent-web` + `packages/agent-playground` (신규 페이지)

- `/monitor` 페이지 (또는 `/playground?mode=monitor`)
- 접속 URL 입력 또는 기본 `ws://localhost:4242` 자동 연결
- `TServerMessage` → `IConversationEvent[]` 변환 훅
- `WorkflowVisualization` + 대화 내용 표시 (읽기 전용)
- 기존 `PlaygroundExecutor` / `PlaygroundAgentSession` 미사용

### 기존 `apps/agent-web` playground (영향 없음)

- 현재 `PlaygroundExecutor` 기반 playground는 별도 유지
- 이 작업은 새 페이지/모드 추가이며 기존 코드 교체가 아님

## Session Lifecycle

- CLI 시작 시 `--web` 플래그가 있으면 서버 시작
- 브라우저가 연결되면 `get-messages` 로 전체 히스토리 동기화
- CLI 종료 시 WebSocket 서버도 함께 종료
- 브라우저 연결 끊김: 재연결 시도 (서버는 계속 동작 중)

## Test Plan

- [ ] `pnpm --filter agent-cli typecheck` — 새 플래그 타입 정합성
- [ ] `pnpm --filter agent-web build` — monitor 페이지 빌드 성공
- [ ] `pnpm --filter agent-transport-ws test` — 기존 ws-handler 테스트 통과
- [ ] `pnpm harness:verify -- --scope packages/agent-cli` — 하네스 검증

## User Execution Test Scenarios

### Scenario 1: CLI 실행 중 브라우저 보조 화면 연결

**Prerequisites:**

- `agent-cli` 빌드 완료 (`pnpm --filter agent-cli build`)
- `agent-web` 실행 중 (`pnpm --filter agent-web start`)
- API 키 설정 완료

**Steps:**

1. `robota --web` 로 CLI 시작
2. TUI에서 "브라우저 모니터: http://localhost:4242" 안내 확인
3. 브라우저에서 http://localhost:3000/monitor 접속
4. 터미널에서 "안녕하세요" 입력 후 전송
5. 브라우저 Workflow 패널에서 실시간 노드 렌더링 확인

**Expected:**

- CLI 응답 스트리밍과 동시에 브라우저에 `text_delta` 이벤트 표시
- 응답 완료 후 Workflow 패널: UserMessage → AssistantResponse 노드

### Scenario 2: 도구 호출 시 브라우저 실시간 반영

**Prerequisites:** Scenario 1과 동일, 도구 사용 유발 프롬프트 사용

**Steps:**

1. CLI에서 도구 사용을 유발하는 메시지 입력
2. 브라우저 Workflow 패널에서 도구 노드 실시간 등장 확인

**Expected:**

- `tool_start` 이벤트 수신 시 ToolCall 노드 즉시 렌더링
- `tool_end` 이벤트 수신 시 ToolResult 노드 추가
- CLI 완료 시 AssistantResponse 노드로 체인 완성

**Evidence:** (구현 후 기록)
