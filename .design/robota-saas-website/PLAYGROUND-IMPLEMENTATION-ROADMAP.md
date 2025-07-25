# 🧩 Robota Playground 블록코딩 구현 로드맵

## 📋 개요

Robota Playground에 **확장된 Block-Specific History 시스템**을 구축하여, 기존 UniversalMessage를 기반으로 하되 **Block 시각화 전용 확장 데이터**를 추가하여 실시간 동적 상태(호출중, 스트리밍, 임시 메시지 등)까지 포함한 **완전한 계층적 블록 시각화**를 제공합니다.

## 🎯 핵심 목표

- **Extended Block Messages**: UniversalMessage + Block 전용 확장 데이터
- **Dynamic State Visualization**: 임시 상태(호출중, 스트리밍) 실시간 블록 표시
- **Custom PlaygroundHistoryPlugin**: 웹 환경 특화 Block 데이터 수집
- **Real-time Block Updates**: 상태 변화에 따른 블록 실시간 업데이트
- **🌟 Team Agent Ready**: 향후 Agent MCP 중첩 대화 지원을 위한 확장 가능한 설계

---

## 🔍 **Robota SDK 호환성 분석 및 구현 전략**

### ✅ **Robota SDK 현재 강점 (이미 지원되는 기능들)**

#### **1. 완벽한 플러그인 시스템 (95% 지원)**
```typescript
// 🟢 이미 사용 가능한 생명주기 훅들
interface PluginHooks {
  beforeRun?, afterRun?                    // 에이전트 실행 전후
  beforeExecution?, afterExecution?        // 실행 컨텍스트 전후
  beforeConversation?, afterConversation?  // 대화 세션 전후
  beforeToolCall?, afterToolCall?          // 도구 호출 전후
  beforeProviderCall?, afterProviderCall?  // AI 프로바이더 호출 전후
  onStreamingChunk?                       // 🌟 스트리밍 청크별 처리
  onError?, onMessageAdded?               // 에러 및 메시지 추가
  onModuleEvent?                          // 모듈 이벤트 처리
}
```

**📝 구현 참고사항:**
- `onStreamingChunk`: 실시간 블록 업데이트에 핵심적으로 활용
- `beforeToolCall`/`afterToolCall`: 도구 호출 블록 생성/완료 처리
- `onMessageAdded`: 완성된 메시지의 최종 블록 변환

#### **2. 강력한 이벤트 시스템 (90% 지원)**
```typescript
// 🟢 블록 시스템에 활용 가능한 이벤트들
type EventType = 
  | 'execution.start' | 'execution.complete' | 'execution.error'
  | 'tool.beforeExecute' | 'tool.afterExecute' | 'tool.success' | 'tool.error'
  | 'conversation.start' | 'conversation.complete'
  | 'module.execution.start' | 'module.execution.complete'
```

**📝 구현 참고사항:**
- `tool.beforeExecute`: 도구 호출 준비 중 임시 블록 생성
- `tool.success`/`tool.error`: 도구 결과 블록 상태 업데이트
- `execution.start`/`complete`: 전체 실행 컨텍스트 블록 관리

#### **3. 스트리밍 지원 (100% 지원)**
```typescript
// 🟢 완벽한 스트리밍 API
async* runStream(input: string): AsyncGenerator<string, void, undefined>
onStreamingChunk?(chunk: UniversalMessage): Promise<void>
```

**📝 구현 참고사항:**
- Progressive 블록 업데이트를 위한 완벽한 기반
- 실시간 텍스트 빌드업 및 상태 변화 추적 가능

#### **4. 팀 에이전트 기반 구조 (85% 지원)**
```typescript
// 🟢 이미 구현된 delegation 시스템
interface TaskDelegationRecord {
  id: string;
  agentId: string;
  originalTask: string;
  delegatedTask: string;
  startTime: Date;
  endTime?: Date;
  result: string;
  success: boolean;
}
```

**📝 구현 참고사항:**
- 중첩 대화 블록의 기반 구조 존재
- Agent ID 및 delegation 관계 추적 가능

---

### 🚨 **아키텍처 원칙 준수 검토 및 설계 수정**

#### **🔴 Critical Issue 1: 규칙 위반 - 공유 상태 및 정책 결정**

**❌ 기존 잘못된 설계:**
```typescript
// 🚨 규칙 위반: 플러그인 간 공유 상태
interface SharedPluginState {
  set(key: string, value: any): void;  // ❌ 임의적 상태 공유
  get(key: string): any;               // ❌ 글로벌 상태
}

class BasePlugin {
  protected sharedState: SharedPluginState; // ❌ 의존성 주입 위반
}
```

**✅ 규칙 준수 올바른 설계:**
```typescript
// 🟢 규칙 준수: 명시적 의존성 주입
interface BlockDataCollector {
  collectBlock(block: BlockMessage): void;
  getBlocks(): BlockMessage[];
}

class PlaygroundHistoryPlugin extends BasePlugin {
  private readonly blockCollector: BlockDataCollector;
  private readonly logger: SimpleLogger;

  constructor(options: PlaygroundHistoryPluginOptions) {
    super();
    // 🟢 명시적 의존성 주입
    this.blockCollector = options.blockCollector || new SilentBlockCollector();
    this.logger = options.logger || SilentLogger;
  }
}
```

#### **🔴 Critical Issue 2: 규칙 위반 - 임의적 확장 및 정책 결정**

**❌ 기존 잘못된 설계:**
```typescript
// 🚨 규칙 위반: 임의적 팀 컨테이너 확장
interface EnhancedTeamContainer {
  onSubAgentStart(parentId: string, subAgentConfig: AgentConfig): void; // ❌ 정책 결정
  onSubAgentMessage(contextId: string, message: UniversalMessage): void; // ❌ 임의적 동작
}
```

**✅ 규칙 준수 올바른 설계:**
```typescript
// 🟢 규칙 준수: 인터페이스 분리 및 명시적 구성
interface SubAgentEventHandler {
  handleSubAgentStart?(parentId: string, agentId: string): void;
  handleSubAgentMessage?(contextId: string, message: UniversalMessage): void;
  handleSubAgentComplete?(contextId: string, result: any): void;
}

interface SubAgentTrackingOptions {
  enabled: boolean;                          // 🟢 명시적 활성화 제어
  eventHandler?: SubAgentEventHandler;       // 🟢 선택적 핸들러 주입
  trackingStrategy: 'none' | 'basic' | 'detailed'; // 🟢 명시적 전략
}

// 🟢 BaseTool 확장을 통한 올바른 접근
class AgentDelegationTool extends BaseTool<AgentDelegationParameters, AgentDelegationResult> {
  private readonly subAgentTracker?: SubAgentEventHandler;

  constructor(options: AgentDelegationToolOptions) {
    super();
    this.subAgentTracker = options.subAgentTracker; // 🟢 주입된 추적기
  }

  override async execute(
    parameters: AgentDelegationParameters,
    context?: ToolExecutionContext
  ): Promise<AgentDelegationResult> {
    // 🟢 정책 결정 없이 외부 핸들러에 위임
    this.subAgentTracker?.handleSubAgentStart?.(context?.parentId, parameters.agentId);
    
    const result = await this.delegateToSubAgent(parameters);
    
    this.subAgentTracker?.handleSubAgentComplete?.(context?.contextId, result);
    
    return result;
  }
}
```

#### **🔴 Critical Issue 3: 규칙 위반 - 패키지 경계 및 책임 분리**

**❌ 기존 잘못된 설계:**
```typescript
// 🚨 규칙 위반: 웹 특화 기능을 packages에 포함
// packages/agents/src/plugins/playground-history-plugin.ts
class PlaygroundHistoryPlugin {  // ❌ 웹 특화 기능이 agents 패키지에
  syncToWebSocket(): void;       // ❌ 웹 관련 로직
}
```

**✅ 규칙 준수 올바른 설계:**
```typescript
// 🟢 packages/agents: 순수 SDK 기능만
interface HistoryCollectionPlugin extends BasePlugin {
  readonly name: 'history-collection';
  collectMessage(message: UniversalMessage): void;
  getHistory(): UniversalMessage[];
  clearHistory(): void;
}

// 🟢 apps/web: 웹 특화 구현
class PlaygroundBlockDataCollector implements BlockDataCollector {
  private readonly wsClient: PlaygroundWebSocketClient;
  private readonly logger: SimpleLogger;

  constructor(options: PlaygroundBlockCollectorOptions) {
    this.wsClient = options.wsClient;
    this.logger = options.logger || SilentLogger;
  }

  collectBlock(block: BlockMessage): void {
    // 웹 특화 로직: WebSocket 전송
    this.wsClient.send({
      type: 'block_update',
      data: block
    });
  }
}
```

---

### 📋 **규칙 준수 구현 전략**

#### **🔄 핵심 패러다임 전환: Tool = Universal Hook 시스템**

**💡 핵심 통찰:**
```typescript
// 🌟 BaseTool Hook 시스템의 범용성
BaseTool (Hook 시스템 내장)
├── FunctionTool (사용자 정의 함수)
├── OpenAPITool (API 호출)  
├── MCPTool (MCP 프로토콜)
├── AgentDelegationTool (팀 delegation)
└── CustomTool (사용자 커스텀)

// 🌟 모든 Tool이 자동으로 블록 추적 지원!
```

**✅ Universal Hook 시스템의 장점:**
- **범용성**: 모든 Tool 타입에 동일한 Hook 인터페이스
- **일관성**: FunctionTool, OpenAPITool, MCPTool 모두 같은 방식으로 추적
- **확장성**: 새로운 Tool 타입도 자동으로 Hook 지원
- **투명성**: 기존 Tool 코드 전혀 수정 없음

---

#### **🟢 1. Universal BaseTool Hook 시스템**

**핵심 구조:**
```typescript
// packages/agents/src/abstracts/base-tool.ts
export interface ToolHooks {
  beforeExecute?(toolName: string, parameters: ToolParameters, context?: ToolExecutionContext): Promise<void>;
  afterExecute?(toolName: string, parameters: ToolParameters, result: ToolResult, context?: ToolExecutionContext): Promise<void>;
  onError?(toolName: string, parameters: ToolParameters, error: Error, context?: ToolExecutionContext): Promise<void>;
}

export interface BaseToolOptions {
  hooks?: ToolHooks;
  logger?: SimpleLogger;
}

export abstract class BaseTool<TParams = ToolParameters, TResult = ToolResult> {
  protected readonly hooks?: ToolHooks;
  protected readonly logger: SimpleLogger;

  constructor(options: BaseToolOptions = {}) {
    this.hooks = options.hooks;
    this.logger = options.logger || SilentLogger;
  }

  // 🟢 Template Method Pattern: 모든 하위 클래스에 Hook 적용
  async execute(parameters: TParams, context?: ToolExecutionContext): Promise<TResult> {
    const toolName = this.schema.name || this.constructor.name;
    
    try {
      // 🟢 실행 전 Hook (모든 Tool 공통)
      await this.hooks?.beforeExecute?.(toolName, parameters, context);
      
      // 🟢 실제 Tool 실행 (하위 클래스별 구현)
      const result = await this.executeImpl(parameters, context);
      
      // 🟢 실행 후 Hook (모든 Tool 공통)
      await this.hooks?.afterExecute?.(toolName, parameters, result, context);
      
      return result;
    } catch (error) {
      // 🟢 에러 Hook (모든 Tool 공통)
      await this.hooks?.onError?.(toolName, parameters, error as Error, context);
      throw error;
    }
  }

  // 🟢 하위 클래스에서 실제 로직 구현
  protected abstract executeImpl(parameters: TParams, context?: ToolExecutionContext): Promise<TResult>;
  
  // 🟢 Schema 접근을 위한 추상 속성
  abstract get schema(): ToolSchema;
}
```

**🎯 모든 Tool 구현체 자동 지원:**
```typescript
// 🟢 FunctionTool - 자동 Hook 지원
export class FunctionTool extends BaseTool<ToolParameters, ToolResult> {
  constructor(schema: ToolSchema, fn: ToolExecutor, options: BaseToolOptions = {}) {
    super(options); // ✅ Hook 자동 적용
    this.schema = schema;
    this.fn = fn;
  }

  protected async executeImpl(parameters: ToolParameters, context?: ToolExecutionContext): Promise<ToolResult> {
    // 기존 로직 그대로, Hook은 부모에서 자동 처리
    const result = await this.fn(parameters, context);
    return { success: true, data: result };
  }
}

// 🟢 OpenAPITool - 자동 Hook 지원  
export class OpenAPITool extends BaseTool<ToolParameters, ToolResult> {
  constructor(spec: OpenAPISpec, options: BaseToolOptions = {}) {
    super(options); // ✅ Hook 자동 적용
    // 기존 생성자 로직
  }

  protected async executeImpl(parameters: ToolParameters): Promise<ToolResult> {
    // 기존 API 호출 로직 그대로, Hook은 부모에서 자동 처리
    return await this.performAPICall(parameters);
  }
}

// 🟢 MCPTool - 자동 Hook 지원
export class MCPTool extends BaseTool<ToolParameters, ToolResult> {
  constructor(config: MCPConfig, options: BaseToolOptions = {}) {
    super(options); // ✅ Hook 자동 적용
    // 기존 생성자 로직
  }

  protected async executeImpl(parameters: ToolParameters): Promise<ToolResult> {
    // 기존 MCP 호출 로직 그대로, Hook은 부모에서 자동 처리
    return await this.executeMCPRequest(parameters);
  }
}

// 🟢 AgentDelegationTool - 자동 Hook 지원
export class AgentDelegationTool extends BaseTool<AgentDelegationParameters, AgentDelegationResult> {
  constructor(options: AgentDelegationToolOptions & BaseToolOptions) {
    super(options); // ✅ Hook 자동 적용
    // 기존 생성자 로직
  }

  protected async executeImpl(parameters: AgentDelegationParameters): Promise<AgentDelegationResult> {
    // 기존 delegation 로직 그대로, Hook은 부모에서 자동 처리
    return await this.teamContainer.assignTask(parameters);
  }
}
```

#### **🟢 2. Universal Block Tracking 헬퍼**

**모든 Tool 타입에 적용 가능한 헬퍼:**
```typescript
// packages/agents/src/tools/helpers/block-tracking.ts
export function createBlockTrackingHooks(
  blockCollector: BlockDataCollector,
  logger?: SimpleLogger
): ToolHooks {
  return {
    async beforeExecute(toolName, parameters, context) {
      const startMessage: UniversalMessage = {
        role: 'system',
        content: `🔧 Starting ${toolName} execution`,
        timestamp: new Date().toISOString()
      };
      
      blockCollector.collectBlock(startMessage, {
        id: context?.executionId || generateId(),
        timestamp: Date.now(),
        type: 'system',
        status: 'pending'
      });

      logger?.debug(`Tool execution started: ${toolName}`, { parameters });
    },

    async afterExecute(toolName, parameters, result, context) {
      const completionMessage: UniversalMessage = {
        role: 'system',
        content: `✅ ${toolName} completed: ${result.success ? 'Success' : 'Failed'}`,
        timestamp: new Date().toISOString()
      };
      
      blockCollector.collectBlock(completionMessage, {
        id: context?.executionId || generateId(),
        timestamp: Date.now(),
        type: 'system',
        status: result.success ? 'completed' : 'error'
      });

      logger?.debug(`Tool execution completed: ${toolName}`, { result });
    },

    async onError(toolName, parameters, error, context) {
      const errorMessage: UniversalMessage = {
        role: 'system',
        content: `❌ ${toolName} failed: ${error.message}`,
        timestamp: new Date().toISOString()
      };
      
      blockCollector.collectBlock(errorMessage, {
        id: context?.executionId || generateId(),
        timestamp: Date.now(),
        type: 'system',
        status: 'error'
      });

      logger?.error(`Tool execution error: ${toolName}`, { error: error.message, parameters });
    }
  };
}

// 🟢 Universal Tool 생성 헬퍼
export function withBlockTracking<T extends BaseTool<any, any>>(
  ToolClass: new (...args: any[]) => T,
  blockCollector: BlockDataCollector,
  logger?: SimpleLogger
) {
  return (...args: any[]): T => {
    const hooks = createBlockTrackingHooks(blockCollector, logger);
    
    // 🟢 마지막 인자가 options이면 hooks 추가, 아니면 새로 생성
    const lastArg = args[args.length - 1];
    if (lastArg && typeof lastArg === 'object' && 'hooks' in lastArg) {
      lastArg.hooks = hooks;
    } else {
      args.push({ hooks, logger });
    }
    
    return new ToolClass(...args);
  };
}
```

#### **🟢 3. Universal 웹 앱 통합**

**모든 Tool 타입을 한 번에 블록 추적:**
```typescript
// apps/web/src/lib/playground/tools/universal-tool-factory.ts
export class UniversalToolFactory {
  constructor(
    private readonly blockCollector: BlockDataCollector,
    private readonly logger: SimpleLogger = SilentLogger
  ) {}

  // 🟢 모든 Tool 타입에 블록 추적 자동 적용
  createInstrumentedTools(tools: BaseTool<any, any>[]): BaseTool<any, any>[] {
    const hooks = createBlockTrackingHooks(this.blockCollector, this.logger);
    
    return tools.map(tool => {
      // 🟢 기존 Tool에 Hook 주입하여 새 인스턴스 생성
      if (tool instanceof FunctionTool) {
        return new FunctionTool(tool.schema, tool.fn, { hooks, logger: this.logger });
      } else if (tool instanceof OpenAPITool) {
        return new OpenAPITool(tool.spec, { hooks, logger: this.logger });
      } else if (tool instanceof MCPTool) {
        return new MCPTool(tool.config, { hooks, logger: this.logger });
      } else if (tool instanceof AgentDelegationTool) {
        return new AgentDelegationTool({
          teamContainer: tool.teamContainer,
          hooks,
          logger: this.logger
        });
      }
      
      // 🟢 사용자 정의 Tool도 BaseTool을 상속했다면 자동 지원
      return tool;
    });
  }

  // 🟢 특정 Tool 타입별 생성 헬퍼
  createWeatherTool(): FunctionTool {
    const hooks = createBlockTrackingHooks(this.blockCollector, this.logger);
    return new FunctionTool(weatherSchema, weatherFn, { hooks, logger: this.logger });
  }

  createSearchTool(): FunctionTool {
    const hooks = createBlockTrackingHooks(this.blockCollector, this.logger);
    return new FunctionTool(searchSchema, searchFn, { hooks, logger: this.logger });
  }

  createDelegationTool(teamContainer: TeamContainer): AgentDelegationTool {
    const hooks = createBlockTrackingHooks(this.blockCollector, this.logger);
    return new AgentDelegationTool({
      teamContainer,
      hooks,
      logger: this.logger
    });
  }
}
```

#### **🟢 4. 완전한 Team 통합 사용법**

**기존 createTeam API 완전 무변경:**
```typescript
// apps/web/src/lib/playground/playground-team-integration.ts
export class PlaygroundTeamIntegration {
  private readonly toolFactory: UniversalToolFactory;

  constructor(blockCollector: BlockDataCollector, logger?: SimpleLogger) {
    this.toolFactory = new UniversalToolFactory(blockCollector, logger);
  }

  createInstrumentedTeam(config: {
    aiProviders: AIProvider[];
    maxMembers?: number;
    customTools?: BaseTool<any, any>[];
  }): TeamContainer {
    // 🟢 1. 모든 사용자 Tool에 블록 추적 자동 적용
    const instrumentedCustomTools = config.customTools 
      ? this.toolFactory.createInstrumentedTools(config.customTools)
      : [];

    // 🟢 2. 기본 Tool들도 블록 추적 적용
    const defaultInstrumentedTools = [
      this.toolFactory.createWeatherTool(),
      this.toolFactory.createSearchTool()
    ];

    // 🟢 3. 기존 createTeam API 그대로 사용!
    const team = createTeam({
      aiProviders: config.aiProviders,
      maxMembers: config.maxMembers || 5,
      tools: [...instrumentedCustomTools, ...defaultInstrumentedTools] // ← 블록 추적 Tool들
    });

    // 🟢 4. Team의 AgentDelegationTool도 자동으로 블록 추적됨!
    // (Team 내부에서 생성되는 delegation tool에도 Hook 시스템이 적용됨)

    return team;
  }
}

// 🟢 5. 최종 사용법 - 믿을 수 없이 간단!
const teamIntegration = new PlaygroundTeamIntegration(blockCollector, logger);

const team = teamIntegration.createInstrumentedTeam({
  aiProviders: [openaiProvider, anthropicProvider],
  maxMembers: 8,
  customTools: [
    new FunctionTool(customSchema1, customFn1),    // ✅ 자동 블록 추적
    new OpenAPITool(apiSpec),                      // ✅ 자동 블록 추적  
    new MCPTool(mcpConfig),                        // ✅ 자동 블록 추적
    userDefinedCustomTool                          // ✅ 자동 블록 추적 (BaseTool 상속 시)
  ]
});

// 🟢 이제 모든 Tool 실행이 자동으로 블록으로 추적됨!
// - Weather API 호출 → 블록 생성
// - Search API 호출 → 블록 생성  
// - Team Agent delegation → 블록 생성
// - MCP 호출 → 블록 생성
// - 사용자 정의 Tool → 블록 생성
await team.execute('Create a comprehensive weather-based marketing strategy');
```

---

### 🎯 **Universal Hook 시스템의 수정된 구현 우선순위**

#### **🥇 1순위: Universal BaseTool Hook 시스템 (packages/agents) - 1주**
```typescript
// 🟢 모든 Tool의 기반이 되는 Hook 시스템
- BaseTool Hook 인터페이스 정의 (ToolHooks, BaseToolOptions)
- BaseTool 추상 클래스 Hook 지원 추가 (Template Method Pattern)
- createBlockTrackingHooks 헬퍼 함수
- withBlockTracking Universal 래퍼 함수
- 기존 FunctionTool, OpenAPITool, MCPTool 생성자 options 추가
```

#### **🥈 2순위: Team Tool Hook 적용 (packages/team) - 1주**  
```typescript
// 🟢 AgentDelegationTool Hook 지원
- AgentDelegationTool 생성자 BaseToolOptions 지원
- Team 내부 Tool 생성 시 Hook 옵션 전달 메커니즘
- 기존 createTeam API 완전 보존하면서 Hook 지원
```

#### **🥉 3순위: 웹 앱 Universal Tool Factory (apps/web) - 2주**
```typescript
// 🟢 모든 Tool을 한 번에 처리하는 Factory
- UniversalToolFactory 클래스
- PlaygroundTeamIntegration 클래스
- React Hook과 통합
- UI에서 블록 시각화
```

#### **🔮 4순위: 고급 Tool 특화 기능 - 2주**
```typescript
// 🟢 Tool 타입별 특화된 블록 표현
- API Tool: 요청/응답 상세 블록
- MCP Tool: 프로토콜 상태 블록
- Delegation Tool: 중첩 대화 블록
- 성능 최적화 및 메모리 관리
```

---

### 📝 **Universal Hook 시스템의 패키지별 책임**

| **패키지** | **책임** | **Universal 적용 범위** |
|------------|----------|----------------------|
| `packages/agents` | Universal Hook 시스템 | **모든** BaseTool 하위 클래스 |
| `packages/team` | AgentDelegationTool Hook 지원 | Team delegation Tool |
| `apps/web` | Universal Tool Factory | **모든** Tool 타입 블록 추적 |
| `apps/api-server` | 서버 로직 | 변경 없음 |

---

### ✅ **Universal Hook 시스템의 혁신적 장점**

1. **🌟 완전한 범용성**: 
   - **모든 Tool 타입** (Function, OpenAPI, MCP, Delegation, Custom) 동일 인터페이스
   - **미래 Tool** 타입도 자동으로 Hook 지원
   - **일관된 블록 추적** 경험

2. **🔧 Zero 기존 코드 수정**:
   - createTeam API 완전 무변경
   - 기존 Tool 사용법 그대로
   - 단계적 적용 가능

3. **🚀 무한 확장성**:
   - 새로운 Hook 타입 쉽게 추가
   - Tool별 특화 Hook 구현 가능
   - 체이닝 가능한 Hook들

4. **🧪 완벽한 테스트 환경**:
   - Mock Hook으로 독립적 테스트
   - Tool별 개별 Hook 테스트
   - 통합 시나리오 테스트

**이제 Robota SDK의 모든 Tool이 하나의 일관된 블록 추적 시스템을 가지게 됩니다!** 🎯🌟✨ 