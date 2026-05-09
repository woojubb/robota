---
id: PLG-002
title: 'agent-web 패키지 — CLI 세션 브라우저 모니터 (Phase 1) + 양방향 제어 (Phase 2)'
status: backlog
priority: medium
created: 2026-05-10
area: packages/agent-web, packages/agent-cli, apps/agent-web
---

## Vision

`agent-cli`를 사용하는 사람이 보조 모니터로 브라우저를 열어 실행 현황을 실시간으로 시각화한다.
Phase 2에서는 TUI와 브라우저가 동일한 `InteractiveSession`을 공유하며 양방향으로 입력이 가능해진다.

```
Phase 1 (읽기 전용 모니터)
  사용자
    ├── 터미널: agent-cli (입력 + TUI)
    │     └── InteractiveSession
    │           └── createWsTransport → WS 서버 (사이드카)
    └── 브라우저: apps/agent-web (읽기 전용 보조 화면)
          └── WS 연결 → 이벤트 수신 → WorkflowVisualization

Phase 2 (양방향 공유 세션)
  사용자
    ├── 터미널: agent-cli TUI → session.submit(prompt)
    └── 브라우저: agent-web UI → session.submit(prompt)  ← 양쪽 모두 입력 가능
          └── 동일한 InteractiveSession, 이벤트는 두 클라이언트 모두에게 브로드캐스트
```

## Background

`agent-cli`는 `agent-sdk + TUI` 조합이다.
`agent-transport-ws`는 `InteractiveSession`을 WebSocket으로 노출하는 표준 어댑터로 이미 존재한다.
새 패키지 `packages/agent-web`은 이 WebSocket 프로토콜을 소비하는 브라우저 UI 라이브러리다.

기존 `packages/agent-playground`는 별도 유지된다. `agent-playground`는 에이전트를 브라우저에서
직접 구성·실행하는 독립형 플레이그라운드이고, `agent-web`은 CLI 세션을 구독하는 관찰/제어 UI다.

## New Package: `packages/agent-web`

CLI 세션을 브라우저에서 관찰·제어하기 위한 React 컴포넌트 라이브러리.
`apps/agent-web`(Next.js 앱)이 이 패키지를 소비한다.

```
packages/agent-web/
  src/
    client/              # WS 클라이언트 (TServerMessage 수신)
      ws-session-client.ts
      session-event-reducer.ts   # TServerMessage → 대화 상태
    components/
      SessionMonitor.tsx          # 메인 컴포넌트 (Phase 1: 읽기 전용)
      SessionController.tsx       # Phase 2: 입력 포함
      conversation-view/          # 대화 내용 표시
      workflow-view/              # WorkflowVisualization 래핑
    hooks/
      useWsSession.ts             # WS 연결 + 이벤트 상태 관리
```

## Protocol (agent-transport-ws 기존 정의 그대로)

서버 → 클라이언트:

| type         | payload                        | Phase 1 처리         |
| ------------ | ------------------------------ | -------------------- |
| `text_delta` | `{ delta: string }`            | 스트리밍 텍스트 누적 |
| `tool_start` | `{ state: IToolState }`        | ToolCall 노드 추가   |
| `tool_end`   | `{ state: IToolState }`        | ToolResult 노드 추가 |
| `thinking`   | `{ isThinking: boolean }`      | thinking 인디케이터  |
| `complete`   | `{ result: IExecutionResult }` | 턴 완료, 노드 확정   |
| `messages`   | `{ messages: [...] }`          | 전체 히스토리 초기화 |
| `error`      | `{ message: string }`          | 에러 표시            |

클라이언트 → 서버 (Phase 2에서 활성화):

| type     | payload              | 의미        |
| -------- | -------------------- | ----------- |
| `submit` | `{ prompt: string }` | 메시지 전송 |
| `abort`  | —                    | 실행 중단   |

## Scope

### Phase 1 — 읽기 전용 모니터

**`packages/agent-cli` (수정)**

- `--web` / `--web-port <port>` 플래그 추가 (기본값: 비활성, 기본 포트: 4242)
- 플래그 활성 시: 로컬 HTTP + WebSocket 서버 시작
- `createWsTransport` 를 `InteractiveSession` 에 연결
- TUI 하단에 "Web monitor: http://localhost:\<port\>" 안내 표시

**`packages/agent-web` (신규)**

- `@robota-sdk/agent-transport-ws` 를 클라이언트로 소비하는 WS 훅
- `TServerMessage` → `IConversationEvent[]` 변환 (읽기 전용 상태머신)
- `SessionMonitor` 컴포넌트: 연결 URL 입력 + 이벤트 수신 + 시각화
- `WorkflowVisualization` 재사용 (`agent-playground` 에서 import)

**`apps/agent-web` (수정)**

- `/monitor` 페이지 추가 → `SessionMonitor` 컴포넌트 렌더링
- 기본 연결 URL: `ws://localhost:4242`

### Phase 2 — 양방향 공유 세션

**`packages/agent-cli` (수정)**

- 다중 WS 클라이언트 지원 (연결당 동일 `InteractiveSession` 공유)
- 브라우저에서 `submit` 수신 시 `session.submit()` 호출
- 모든 연결 클라이언트에 이벤트 브로드캐스트

**`packages/agent-web` (수정)**

- `SessionController` 컴포넌트: 입력창 + 전송 버튼 + abort 버튼 추가
- `submit` / `abort` 메시지 전송 기능

## Test Plan

- [ ] `pnpm --filter @robota-sdk/agent-web build` — 새 패키지 빌드 성공
- [ ] `pnpm --filter agent-cli typecheck` — 새 플래그 타입 정합성
- [ ] `pnpm --filter agent-web build` — `/monitor` 페이지 포함 빌드 성공
- [ ] `pnpm --filter @robota-sdk/agent-transport-ws test` — 기존 ws-handler 테스트 통과
- [ ] `pnpm harness:verify -- --scope packages/agent-cli` — 하네스 검증

## User Execution Test Scenarios

### Scenario 1 (Phase 1): CLI 실행 중 브라우저 보조 화면 연결

**Prerequisites:**

- `agent-cli` 빌드 완료
- `apps/agent-web` 실행 중 (`pnpm --filter agent-web start`)
- API 키 설정 완료

**Steps:**

1. `robota --web` 으로 CLI 시작
2. TUI에서 "Web monitor: http://localhost:4242" 안내 확인
3. 브라우저에서 http://localhost:3000/monitor 접속
4. 터미널에서 "안녕하세요" 입력 후 전송
5. 브라우저 Workflow 패널에서 실시간 노드 렌더링 확인

**Expected:**

- CLI 응답 스트리밍과 동시에 브라우저에 `text_delta` 이벤트 표시
- Workflow 패널: UserMessage → AssistantResponse 노드 체인

### Scenario 2 (Phase 2): 브라우저에서 메시지 전송 후 CLI TUI에 반영

**Prerequisites:** Scenario 1 환경 + Phase 2 구현 완료

**Steps:**

1. `robota --web` 으로 CLI 시작 후 브라우저 `/monitor` 접속
2. 브라우저 입력창에 "브라우저에서 보내는 메시지" 전송
3. 터미널 TUI에서 해당 메시지와 AI 응답 확인
4. TUI에서 응답 스트리밍이 브라우저에도 실시간 표시되는지 확인

**Expected:**

- 브라우저 → CLI 방향 입력이 동일 세션에서 처리됨
- TUI와 브라우저 양쪽에 동일한 응답 스트리밍

**Evidence:** (구현 후 기록)
