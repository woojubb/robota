# 에이전트 외부 통신 표준화 아키텍처

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

## 패키지 구조

```
packages/
  agent-core/           ← IAgentGateway 인터페이스 소유 (계약)
  agent-gateway/        ← 새 패키지: DefaultAgentGateway 구현 (Robota → IAgentGateway 변환)
  agent-transport-http/ ← 새 패키지: HTTP 어댑터 (Hono 기반, CF Workers / Lambda 호환)
  agent-transport-mcp/  ← 새 패키지: MCP 어댑터
  agent-transport-ws/   ← 새 패키지: WebSocket 어댑터
  agent-remote/         ← 리팩토링: 클라이언트만 남기고 서버 코드는 transport-http로 이동
  agent-cli/            ← 기존: stdin/stdout 어댑터 역할 (IAgentGateway 소비)
```

### 의존성 방향

```
agent-transport-http  → agent-gateway → agent-core
agent-transport-mcp   → agent-gateway → agent-core
agent-transport-ws    → agent-gateway → agent-core
agent-cli             → agent-sdk     → agent-core
agent-remote (client) → agent-core (IExecutor, 기존 유지)
```

## 기존 코드와의 관계

| 기존                                     | 이후                                  |
| ---------------------------------------- | ------------------------------------- |
| agent-remote 서버 코드 (Express routes)  | → agent-transport-http (Hono)         |
| agent-remote 클라이언트 (RemoteExecutor) | → agent-remote (유지, IExecutor 방향) |
| agent-remote transport-interface.ts      | → agent-core IAgentGateway로 승격     |
| agent-server (app) WebSocket             | → agent-transport-ws                  |
| agent-cli App.tsx session.run()          | → IAgentGateway.stream() 소비         |

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

1. `IAgentGateway` 인터페이스를 agent-core에 추가
2. `agent-gateway` 패키지: Robota/Session → IAgentGateway 브릿지
3. `agent-transport-http`: Hono 기반 HTTP 어댑터 (CF Workers + Lambda 호환)
4. agent-cli를 IAgentGateway 소비로 전환
5. `agent-transport-mcp`: MCP 어댑터
6. `agent-transport-ws`: WebSocket 어댑터
7. agent-remote 리팩토링 (서버 코드 제거, 클라이언트만)
