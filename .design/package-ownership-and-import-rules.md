# 패키지 소유권 및 Import 규칙 (초안)

> **상태**: 초안 — 검증 및 확정 전

## 목적

각 패키지가 무엇을 소유하는지, 다른 패키지에서 무엇을 import할 수 있는지 명확히 정의한다.

## 패키지별 소유권

### agent-core

역할: 기초 계약, 추상화, 타입 시스템

**소유하는 것:**

- 메시지 타입: `TUniversalMessage`, `IBaseMessage`, `IAssistantMessage`, `TMessageState`
- 메시지 팩토리: `createSystemMessage`, `createUserMessage`, `createAssistantMessage`, `createToolMessage`
- 메시지 타입 가드: `isToolMessage`, `isAssistantMessage`
- 권한 평가: `evaluatePermission()`, `TPermissionMode`, `IPermissionLists`, `TToolArgs`
- 모델: `CLAUDE_MODELS`, `getModelName`, `formatTokenCount`, `DEFAULT_MAX_OUTPUT`
- 추상: `AbstractAIProvider`, `IExecutor`, `IEventService`
- 훅: `runHooks`, `CommandExecutor`, `HttpExecutor`
- 플러그인: `EventEmitterPlugin`
- 내부 엔진: `Robota`, `ExecutionService`, `ConversationStore`, `AgentFactory`

**공개 vs 내부 구분:**

- 공개 (외부 패키지가 import 가능): 타입, 팩토리, 유틸리티, 추상 클래스
- 내부 (SDK/sessions를 통해서만 소비): `Robota`, `ExecutionService`, `ConversationStore`

### agent-sessions

역할: 세션 라이프사이클

**소유하는 것:**

- `Session` (run, abort, permissions, compaction, hooks 실행)
- `TPermissionHandler`, `TPermissionResult` (콜백 패턴과 반환 타입)
- `ISessionOptions`
- `FileSessionLogger`, `SilentSessionLogger`, `ISessionLogger`
- `SessionStore`, `ISessionRecord`

### agent-tools

역할: 도구 인프라 + 빌트인 도구

**소유하는 것:**

- `ToolRegistry`, `FunctionTool`, `createFunctionTool`, `createZodFunctionTool`
- `OpenAPITool`, `createOpenAPITool`
- `TToolResult`, `zodToJsonSchema`
- 빌트인 도구 8개: bash, read, write, edit, glob, grep, webFetch, webSearch

### agent-provider-\*

역할: AI 프로바이더 구현

**소유하는 것:**

- 각 프로바이더 클래스 (`AnthropicProvider`, `GoogleProvider` 등)
- 프로바이더별 옵션 타입 (`IAnthropicProviderOptions` 등)

### agent-sdk

역할: 조립 캔버스 + 상호작용 레이어

**소유하는 것:**

- 조립: `createSession()`, `createDefaultTools()`, `createProvider()`
- 상호작용: `InteractiveSession` (Session을 래핑, 스트리밍 축적, 큐잉, abort)
- 명령어: `SystemCommandExecutor`, `ISystemCommand`, `ICommandResult`
- 명령어 발견: `CommandRegistry`, `ICommand`, `ICommandSource`, `BuiltinCommandSource`, `SkillCommandSource`
- 편의 API: `query()`
- config/context: `loadConfig()`, `loadContext()`, `detectProject()`, `buildSystemPrompt()`
- 경로: `projectPaths()`, `userPaths()`
- 플러그인 관리: `BundlePluginLoader`, `BundlePluginInstaller`, `PluginSettingsStore`, `MarketplaceClient`
- 서브에이전트: `createSubagentSession()`, `AgentDefinitionLoader` (internal)
- 훅 실행기: `PromptExecutor`, `AgentExecutor`

### agent-cli

역할: 터미널 TUI 제품

**소유하는 것:**

- Ink 컴포넌트: App, MessageList, InputArea, StreamingIndicator, StatusBar, PermissionPrompt, PluginTUI 등
- TUI 전용 hooks: `useInteractiveSession` (SDK↔React 브릿지)
- 슬래시 명령어 파싱: `slash-executor.ts` (슬래시 프리픽스 처리, SDK의 SystemCommandExecutor 호출)
- CLI 전용 유틸: `settings-io`, `paste-labels`, `edit-diff`, `cli-args`
- 렌더링: CjkTextInput, DiffBlock, WaveText 등

### agent-transport-\*

역할: InteractiveSession을 프로토콜로 노출하는 어댑터 라이브러리

**소유하는 것:**

- transport-http: `createAgentRoutes()` (Hono 라우터)
- transport-mcp: `createAgentMcpServer()` (MCP 서버)
- transport-ws: `createWsHandler()` (WebSocket 메시지 핸들러)

## Import 규칙

### agent-cli의 import 규칙

| 소스              | 허용 범위            | 예시                                                                  |
| ----------------- | -------------------- | --------------------------------------------------------------------- |
| agent-sdk         | SDK가 소유한 모든 것 | InteractiveSession, CommandRegistry, createSession, loadConfig        |
| agent-core        | 공개 타입 + 유틸리티 | TUniversalMessage, TPermissionMode, createSystemMessage, getModelName |
| agent-core        | ❌ 내부 엔진         | ~~Robota~~, ~~ExecutionService~~, ~~ConversationStore~~               |
| agent-sessions    | 타입만               | TPermissionResult, TPermissionHandler                                 |
| agent-sessions    | ❌ 클래스/로직       | ~~Session~~, ~~FileSessionLogger~~ (SDK를 통해 소비)                  |
| agent-tools       | ❌ 전체 금지         | SDK가 도구를 조립해서 제공                                            |
| agent-provider-\* | ❌ 전체 금지         | SDK가 프로바이더를 조립해서 제공                                      |

### agent-sdk의 import 규칙

| 소스              | 허용 범위                              |
| ----------------- | -------------------------------------- |
| agent-core        | 전체 (SDK는 core 위에서 조립하는 역할) |
| agent-sessions    | 전체 (Session, Logger, Store 등 사용)  |
| agent-tools       | 전체 (빌트인 도구 조립)                |
| agent-provider-\* | 전체 (프로바이더 생성)                 |

### agent-transport-\*의 import 규칙

| 소스       | 허용 범위                                            |
| ---------- | ---------------------------------------------------- |
| agent-sdk  | InteractiveSession, SystemCommandExecutor, 관련 타입 |
| agent-core | ❌ 직접 import 금지 (SDK를 통해 소비)                |

### agent-sessions의 import 규칙

| 소스       | 허용 범위                                    |
| ---------- | -------------------------------------------- |
| agent-core | 전체                                         |
| agent-sdk  | ❌ 금지 (하위 패키지가 상위를 의존하면 순환) |

### agent-tools의 import 규칙

| 소스       | 허용 범위 |
| ---------- | --------- |
| agent-core | 전체      |
| agent-sdk  | ❌ 금지   |

## 검증 필요 사항

1. CLI가 sessions에서 타입만 import하는 규칙이 적절한가? 아니면 CLI가 sessions를 아예 모르는 게 나은가?
2. transport 패키지가 core에서 직접 import를 금지하는 게 맞는가? 타입이 필요하면?
3. `PluginCommandSource`는 현재 CLI에만 있는데, SDK로 이동해야 하는가? (plugin 발견은 SDK 영역?)
4. SDK가 `agent-provider-anthropic`을 직접 의존하는 게 맞는가? 프로바이더 선택은 CLI/앱 레벨 결정 아닌가?
