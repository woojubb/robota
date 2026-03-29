# 에이전트 외부 통신 표준화 아키텍처

> **상태**: 설계 확정 (2026-03-26)

## 문제

에이전트를 외부에 노출하는 표준 방법이 없다. CLI는 터미널, Playground는 WebSocket, Remote는 Express — 각각 독자 구현이고 새 프로토콜(MCP, CF Worker RPC) 추가 시 처음부터 구현해야 한다.

## 설계 원칙

1. **에이전트는 프로토콜을 모른다** — InteractiveSession은 HTTP인지 WebSocket인지 MCP인지 모름
2. **어댑터가 프로토콜을 안다** — 각 프로토콜의 어댑터가 InteractiveSession API를 해당 프로토콜로 변환
3. **별도 gateway 인터페이스 없음** — InteractiveSession이 이미 gateway 역할. 중간 추상화 레이어 불필요

## 아키텍처

```
                    ┌──────────────────────────┐
                    │   InteractiveSession     │
                    │      (agent-sdk)          │
                    │                          │
                    │  submit(prompt)           │
                    │  abort() / cancelQueue()  │
                    │  on('text_delta', ...)    │
                    │  getMessages()            │
                    │  SystemCommandExecutor    │
                    └────────────▲─────────────┘
                                 │ 직접 소비
          ┌──────────┬───────────┼───────────┬──────────┐
          │          │           │           │          │
    ┌─────┴────┐ ┌───┴───┐ ┌────┴───┐ ┌────┴───┐ ┌───┴────┐
    │  HTTP    │ │  WS   │ │  MCP   │ │  CF    │ │  CLI   │
    │ Adapter  │ │Adapter│ │Adapter │ │Worker  │ │ (Ink)  │
    │ (Hono)   │ │       │ │        │ │RPC     │ │        │
    └──────────┘ └───────┘ └────────┘ └────────┘ └────────┘
```

별도 IAgentGateway 인터페이스 없음 — InteractiveSession이 이미 모든 클라이언트의 공통 API.

## 어댑터별 InteractiveSession API 매핑

### HTTP Adapter (Hono)

```
POST /submit       → session.submit(prompt)  → SSE 이벤트 스트림
POST /command      → commandExecutor.execute(name, session, args) → JSON
POST /abort        → session.abort()
POST /cancel-queue → session.cancelQueue()
GET  /messages     → session.getMessages()
GET  /context      → session.getContextState()
GET  /status       → session.isExecuting() + getPendingPrompt()
```

### MCP Adapter

```
tools/list         → commandExecutor.listCommands() + 도구 목록
tools/call         → session.submit(prompt) → complete 이벤트 대기 → 결과 반환
```

### WebSocket Adapter

```
connect            → InteractiveSession 생성
message:submit     → session.submit(prompt) → 이벤트를 WS로 푸시
message:command    → commandExecutor.execute()
message:abort      → session.abort()
disconnect         → 세션 정리
```

### CLI (현재)

```
useInteractiveSession hook → InteractiveSession 이벤트 → React state
ESC → session.abort()
Backspace → session.cancelQueue()
```

## 확정된 결정 사항

| 결정                     | 선택                                     | 이유                            |
| ------------------------ | ---------------------------------------- | ------------------------------- |
| gateway 인터페이스       | 불필요 — InteractiveSession이 gateway    | SDK API를 그대로 노출하면 됨    |
| agent-gateway 패키지     | 불필요                                   | 중간 레이어 없음                |
| transport 패키지 구조    | 프로토콜별 분리 (http, mcp, ws)          | 필요한 것만 설치 가능           |
| agent-remote             | 클라이언트(RemoteExecutor) 전용으로 유지 | SDK와 역할 다름                 |
| agent-remote-server-core | transport 패키지로 대체 후 폐기          | Express 결합 제거               |
| 슬래시 명령어 시스템     | SDK에 이미 이동 완료                     | HTTP/MCP에서도 명령어 실행 가능 |
| 입력 방식                | 단일 프롬프트 (submit)                   | 히스토리는 에이전트 내부 관리   |

## 패키지 구조

```
packages/
  agent-transport-http/ ← 신규: HTTP 어댑터 (Hono 기반, CF Workers / Lambda 호환)
  agent-transport-mcp/  ← 신규: MCP 어댑터
  agent-transport-ws/   ← 신규: WebSocket 어댑터
  agent-remote/         ← 리팩토링: 클라이언트(RemoteExecutor)만 유지, 서버 코드 제거
  agent-remote-server-core/ ← 폐기 예정: transport 패키지로 대체
  agent-cli/            ← 순수 TUI: InteractiveSession 이벤트 → 터미널 렌더링
```

### 의존성 방향

```
agent-transport-http  → agent-sdk (InteractiveSession) → agent-core
agent-transport-mcp   → agent-sdk (InteractiveSession) → agent-core
agent-transport-ws    → agent-sdk (InteractiveSession) → agent-core
agent-cli             → agent-sdk (InteractiveSession) → agent-core
agent-remote (client) → agent-core (IExecutor)
```

## 기존 코드와의 관계

| 기존                                     | 이후                                    |
| ---------------------------------------- | --------------------------------------- |
| agent-remote 서버 코드 (Express routes)  | → agent-transport-http (Hono)           |
| agent-remote 클라이언트 (RemoteExecutor) | → agent-remote (유지, 클라이언트 전용)  |
| agent-remote-server-core (Express)       | → 폐기, transport 패키지로 대체         |
| agent-remote transport-interface.ts      | → 폐기 (InteractiveSession이 대체)      |
| agent-server (app) WebSocket             | → agent-transport-ws                    |
| agent-cli useSession/useSubmitHandler    | → 완료: agent-sdk InteractiveSession    |
| agent-cli 슬래시 명령어 시스템           | → 완료: agent-sdk SystemCommandExecutor |

## 구현 순서

~~1. InteractiveSession을 agent-sdk에 구현~~ ✅ 완료
~~2. 슬래시 명령어 시스템을 agent-sdk로 이동~~ ✅ 완료
~~3. CLI를 InteractiveSession 이벤트 구독 방식으로 리팩토링~~ ✅ 완료 4. `agent-transport-http`: Hono 기반 HTTP 어댑터 (CF Workers + Lambda 호환) 5. `agent-transport-mcp`: MCP 어댑터 6. `agent-transport-ws`: WebSocket 어댑터 7. agent-remote 리팩토링 (서버 코드 제거, 클라이언트만) 8. agent-remote-server-core 폐기
