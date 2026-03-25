# 에이전트 외부 통신 표준화 아키텍처

> **상태**: 설계 확정 (2026-03-25)

## 문제

에이전트를 외부에 노출하는 표준 계약이 없다. CLI는 터미널, Playground는 WebSocket, Remote는 Express — 각각 독자 구현이고 새 프로토콜(MCP, CF Worker RPC) 추가 시 처음부터 구현해야 한다.

## 현재 구조

```
IExecutor (agent-core)
  → 클라이언트 방향: "에이전트가 AI를 호출하는 방법"
  → LocalExecutor, RemoteExecutor, CacheExecutor

빠져있는 것:
  → 서버 방향: "외부가 에이전트를 호출하는 방법"
```

`agent-remote`가 서버 역할을 하지만:

- Express에 직접 결합
- 클라이언트(RemoteExecutor)와 서버(routes)가 한 패키지에 혼재
- MCP, Worker RPC 등 새 프로토콜 대응 불가

## 설계 원칙

1. **에이전트는 프로토콜을 모른다** — Robota 인스턴스는 "요청 받고 응답 반환"만 할 뿐, HTTP인지 WebSocket인지 MCP인지 모름
2. **어댑터가 프로토콜을 안다** — 각 프로토콜의 어댑터가 요청을 표준 형식으로 변환하여 에이전트에 전달
3. **계약은 하나** — 모든 어댑터가 동일한 인터페이스로 에이전트와 통신

## 아키텍처

```
                    ┌──────────────────────────┐
                    │     Robota Instance       │
                    │  (agent-core / agent-sdk) │
                    └────────────▲─────────────┘
                                 │
                    ┌────────────┴─────────────┐
                    │    IAgentGateway          │
                    │  (표준 계약 — 새 패키지)    │
                    │                          │
                    │  chat(req) → response     │
                    │  stream(req) → AsyncIter  │
                    │  listTools() → tools      │
                    │  abort(id) → void         │
                    └────────────▲─────────────┘
                                 │
          ┌──────────┬───────────┼───────────┬──────────┐
          │          │           │           │          │
    ┌─────┴────┐ ┌───┴───┐ ┌────┴───┐ ┌────┴───┐ ┌───┴────┐
    │  HTTP    │ │  WS   │ │  MCP   │ │  CF    │ │ stdin  │
    │ Adapter  │ │Adapter│ │Adapter │ │Worker  │ │/stdout │
    │(Hono/표준)│ │       │ │        │ │RPC     │ │(CLI)   │
    └──────────┘ └───────┘ └────────┘ └────────┘ └────────┘
```

## IAgentGateway 인터페이스 (초안)

```typescript
/** 에이전트를 외부에 노출하는 표준 계약 */
interface IAgentGateway {
  /** 단일 요청-응답 */
  chat(request: IAgentRequest): Promise<IAgentResponse>;

  /** 스트리밍 요청 */
  stream(request: IAgentRequest): AsyncIterable<IAgentStreamEvent>;

  /** 실행 중단 */
  abort(requestId: string): void;

  /** 사용 가능한 도구 목록 */
  listTools(): IToolSchema[];

  /** 에이전트 메타데이터 */
  getInfo(): IAgentInfo;
}

interface IAgentRequest {
  id: string;
  messages: TUniversalMessage[];
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: IToolSchema[];
    signal?: AbortSignal;
  };
}

interface IAgentResponse {
  id: string;
  messages: TUniversalMessage[];
  usage?: ITokenUsage;
  finishReason: 'complete' | 'interrupted' | 'tool_use' | 'error';
}

interface IAgentStreamEvent {
  type: 'text_delta' | 'tool_call' | 'tool_result' | 'complete' | 'error';
  data: unknown;
}

interface IAgentInfo {
  name: string;
  version: string;
  capabilities: {
    streaming: boolean;
    tools: boolean;
    abort: boolean;
    multiTurn: boolean;
  };
}
```

## 어댑터별 매핑

### HTTP Adapter

```
POST /chat         → gateway.chat(req)
POST /stream       → gateway.stream(req) → SSE
DELETE /abort/:id  → gateway.abort(id)
GET /tools         → gateway.listTools()
GET /info          → gateway.getInfo()
```

### MCP Adapter

```
tools/list         → gateway.listTools()
tools/call         → gateway.chat(req) (단일 도구 실행)
resources/list     → gateway.getInfo() + 추가 리소스
prompts/list       → 에이전트의 시스템 프롬프트 목록
```

### Cloudflare Dynamic Worker RPC

```
Worker Loader binding → gateway (호스트 Worker가 IAgentGateway를 가진 Dynamic Worker 생성)
globalOutbound        → provider API 키 주입
```

### WebSocket Adapter

```
connect            → 세션 생성
message:chat       → gateway.chat(req)
message:stream     → gateway.stream(req) → 이벤트 푸시
message:abort      → gateway.abort(id)
disconnect         → 세션 정리
```

### CLI (stdin/stdout)

```
stdin → parse → gateway.stream(req) → render to stdout
Ctrl+C/ESC → gateway.abort(id)
```

## 확정된 결정 사항

| 결정                     | 선택                                                 | 이유                                              |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------- |
| IAgentGateway 소유       | 인터페이스 → agent-core, 구현 → agent-gateway (신규) | 기존 IExecutor 패턴과 동일                        |
| transport 패키지 구조    | 프로토콜별 분리 (http, mcp, ws)                      | 필요한 것만 설치 가능                             |
| agent-remote             | 클라이언트(RemoteExecutor) 전용으로 유지             | SDK와 역할 다름: SDK=로컬 조립, remote=원격 호출  |
| agent-remote-server-core | transport 패키지로 대체 후 폐기                      | Express 결합 제거                                 |
| 슬래시 명령어 시스템     | SDK로 이동                                           | HTTP/MCP 클라이언트에서도 명령어 실행 가능해야 함 |

## 패키지 구조

```
packages/
  agent-core/           ← IAgentGateway 인터페이스 소유 (계약)
  agent-gateway/        ← 신규: DefaultAgentGateway 구현 (InteractiveSession → IAgentGateway)
  agent-transport-http/ ← 신규: HTTP 어댑터 (Hono 기반, CF Workers / Lambda 호환)
  agent-transport-mcp/  ← 신규: MCP 어댑터
  agent-transport-ws/   ← 신규: WebSocket 어댑터
  agent-remote/         ← 리팩토링: 클라이언트(RemoteExecutor)만 유지, 서버 코드 제거
  agent-remote-server-core/ ← 폐기 예정: transport 패키지로 대체
  agent-cli/            ← 순수 TUI: InteractiveSession 이벤트 → 터미널 렌더링
```

### 의존성 방향

```
agent-transport-http  → agent-gateway → agent-sdk → agent-core
agent-transport-mcp   → agent-gateway → agent-sdk → agent-core
agent-transport-ws    → agent-gateway → agent-sdk → agent-core
agent-cli             → agent-sdk (InteractiveSession) → agent-core
agent-remote (client) → agent-core (IExecutor)
```

## 기존 코드와의 관계

| 기존                                     | 이후                                           |
| ---------------------------------------- | ---------------------------------------------- |
| agent-remote 서버 코드 (Express routes)  | → agent-transport-http (Hono)                  |
| agent-remote 클라이언트 (RemoteExecutor) | → agent-remote (유지, 클라이언트 전용)         |
| agent-remote-server-core (Express)       | → 폐기, transport 패키지로 대체                |
| agent-remote transport-interface.ts      | → agent-core IAgentGateway로 승격              |
| agent-server (app) WebSocket             | → agent-transport-ws                           |
| agent-cli useSession/useSubmitHandler    | → agent-sdk InteractiveSession                 |
| agent-cli 슬래시 명령어 시스템           | → agent-sdk CommandRegistry                    |
| agent-cli App.tsx                        | → 순수 TUI: InteractiveSession 이벤트 → 렌더링 |

## IExecutor vs IAgentGateway

|          | IExecutor                     | IAgentGateway                                 |
| -------- | ----------------------------- | --------------------------------------------- |
| 방향     | 클라이언트 → AI               | 외부 → 에이전트                               |
| 소유     | agent-core                    | agent-core (인터페이스), agent-gateway (구현) |
| 역할     | 에이전트가 AI provider를 호출 | 외부가 에이전트를 호출                        |
| 구현     | LocalExecutor, RemoteExecutor | DefaultAgentGateway                           |
| 프로토콜 | HTTP (to AI API)              | HTTP, WS, MCP, RPC (from clients)             |

두 인터페이스는 **반대 방향**이고 둘 다 필요하다.

## 구현 순서

선행: SDK/CLI 책임 분리 (.design/sdk-cli-responsibility-separation.md)

1. InteractiveSession을 agent-sdk에 구현 (CLI hooks 로직 추출)
2. 슬래시 명령어 시스템을 agent-sdk로 이동
3. CLI를 InteractiveSession 이벤트 구독 방식으로 리팩토링
4. `IAgentGateway` 인터페이스를 agent-core에 추가
5. `agent-gateway` 패키지: InteractiveSession → IAgentGateway 브릿지
6. `agent-transport-http`: Hono 기반 HTTP 어댑터 (CF Workers + Lambda 호환)
7. `agent-transport-mcp`: MCP 어댑터
8. `agent-transport-ws`: WebSocket 어댑터
9. agent-remote 리팩토링 (서버 코드 제거, 클라이언트만)
10. agent-remote-server-core 폐기
