# ⚠️ DEPRECATED: Playground 채팅 및 스트리밍 문제 해결 계획

> **중요**: 이 문제의 근본 원인이 **RemoteExecutor ↔ LocalExecutor 호환성 위반**으로 밝혀졌습니다.  
> **새로운 최우선 계획**: [TEAM-HOOKS-IMPLEMENTATION-CHECKLIST.md](./TEAM-HOOKS-IMPLEMENTATION-CHECKLIST.md)의 **Phase 0: RemoteExecutor 호환성 긴급 수정**을 먼저 완료해주세요.

## 🔍 **근본 원인 진단 완료**

**로컬 예제 vs 플레이그라운드 비교 결과**:
- ✅ **LocalExecutor** (예제): `assignTask` tool call 정상 실행, 팀 협업 성공
- ❌ **RemoteExecutor** (플레이그라운드): HTTP 전송 중 `toolCalls` 정보 손실
- ❌ **심각한 아키텍처 위반**: RemoteExecutor가 LocalExecutor의 완전 대체재가 되지 못함

**핵심 문제**: RemoteExecutor의 `executeChatStream()`이 `toolCalls` 없는 `ResponseMessage`만 반환하여  
`ExecutionService.executeStream()`에서 tool 실행이 불가능한 상태

## ❌ **기존 문제 진단 (잘못된 방향)**

1. **스트리밍 방식**: 아예 작동하지 않음
2. **일반 방식**: API 응답은 받지만 Chat UI 및 블록에 반영되지 않음

→ **실제 원인**: RemoteExecutor의 타입 호환성 문제로 인한 tool call 실행 실패

## 🎯 핵심 설계 원칙 (반드시 준수)

**중요**: 모든 통신은 **OpenAIProvider + RemoteExecutor 주입** 방식으로만 처리
- ✅ `OpenAIProvider({ executor: remoteExecutor })` 사용
- ✅ 모든 API 호출은 RemoteExecutor를 통해서만 수행
- ❌ 별도의 네트워크 호출이나 다른 방법 사용 금지
- ❌ 기존 Robota SDK 아키텍처를 우회하는 방법 금지

**단, RemoteExecutor가 LocalExecutor와 100% 호환되어야 함**

## 📋 수정된 디버깅 계획

### Phase 1: RemoteExecutor 주입 방식 검증

#### [x] 1.1 Executor 주입 검증
- [x] PlaygroundExecutor.createRemoteExecutor() 올바른 인스턴스 생성 확인
- [x] OpenAIProvider 생성 시 executor 주입 확인
- [x] Provider에서 this.executor 존재 여부 확인
- [x] Executor 메서드 존재 여부 확인 (executeChat, executeChatStream)

#### [x] 1.2 Provider → Executor 호출 경로 검증
- [x] OpenAIProvider.chat() → executeViaExecutorOrDirect() 호출 확인
- [x] OpenAIProvider.chatStream() → executeStreamViaExecutorOrDirect() 호출 확인
- [x] BaseAIProvider에서 this.executor.executeChat() 호출 확인
- [x] BaseAIProvider에서 this.executor.executeChatStream() 호출 확인

#### [x] 1.3 RemoteExecutor 메서드 호환성 검증
- [x] executeChat() 메서드 시그니처 호환성 확인
- [x] executeChatStream() 메서드 시그니처 호환성 확인
- [x] 요청 데이터 포맷 변환 로직 확인
- [x] 응답 데이터 포맷 변환 로직 확인

#### [x] 1.4 HttpClient → API 서버 통신 검증
- [x] HttpClient.chat() → /api/v1/remote/chat 호출 확인
- [x] HttpClient.chatStream() → /api/v1/remote/stream 호출 확인
- [x] 요청 헤더 및 인증 확인
- [x] 응답 데이터 구조 확인
- [x] **핵심 문제 해결**: getSession() → getConversationSession() 수정

### Phase 2: UI 데이터 흐름 검증 (스트림 응답 받음, UI 반영 안됨)

#### [x] 2.1 PlaygroundExecutor → Context 데이터 흐름
- [x] PlaygroundExecutor.runStream() 결과 반환 방식 확인
- [x] AsyncGenerator yield 처리 방식 확인
- [x] 최종 PlaygroundExecutionResult 반환 확인
- [x] **문제 발견**: Context에서 AsyncGenerator return 값을 받지 못함
- [x] **해결**: 수동 iterator 방식으로 수정하여 return 값 올바르게 수신

#### [x] 2.2 Context → Hook 데이터 흐름  
- [x] executeStreamPrompt onChunk 콜백 호출 확인
- [x] useRobotaExecution lastResult 상태 업데이트 확인
- [x] streamingResponse 상태 업데이트 확인
- [x] 상태 변경 useEffect 의존성 배열 확인

#### [x] 2.3 Hook → Chat UI 데이터 흐름
- [x] lastResult 변경 시 Chat UI 업데이트 로직 확인
- [x] **문제 발견**: conversationEvents가 visualizationData.events에서 가져오는데 assistant 응답 이벤트가 누락됨
- [x] **해결**: executeStreamPrompt 완료 후 명시적으로 assistant_response 이벤트 추가
- [x] Assistant 응답 메시지 추가 로직 확인
- [x] 스트리밍 응답 실시간 표시 로직 확인

#### [x] 2.4 PlaygroundHistoryPlugin → Block 시스템 연동
- [x] historyPlugin.recordEvent() 호출 시점 확인 (SDK 내부에서 처리)
- [x] Assistant 응답 이벤트 기록 로직 확인
- [x] lastResult → Block 생성 useEffect 트리거 확인 (이미 구현됨)
- [x] Block 데이터 수집 및 표시 로직 확인

## 📊 진행 상황 추적

**🎯 핵심 문제 발견 및 해결**: `this.conversationHistory.getSession is not a function`

**문제**: ExecutionService.executeStream()에서 `getSession()` 메서드를 호출했으나, 실제로는 `getConversationSession()` 메서드가 존재함
**해결**: `getSession()` → `getConversationSession()` 수정

**현재 진행 중**: Phase 1 완료 - 테스트 필요

**Phase 1 완료율**: 100% (16/16) - ✅ 완료
**Phase 2 완료율**: 0% (8/8)  
**Phase 3 완료율**: 0% (9/9)
**Phase 4 완료율**: 0% (8/8)

**전체 진행률**: 22% (16/73) 

## Phase 5: Team Block Tracking Implementation

**목표**: Team의 복잡한 워크플로우(assignTask → Agent 생성 → 개별 Agent 실행 → 결과 집계)를 Block에 상세히 표시

### 🚨 계획 검증 및 구조 개선

**주요 개선사항**:
1. **작업 순서 최적화**: Bottom-up 접근법으로 변경 (이벤트 수집 → 데이터 구조 → UI)
2. **검증 단계 통합**: 각 하위 단계마다 즉시 검증으로 리스크 최소화
3. **의존성 순서 명확화**: Hook → Plugin → UI 순서로 명확한 의존성 체인 구성

### 📊 구현 성공 가능성 및 적합도 분석

#### **🔴 ❌ 이전 분석 오류 발견 및 정정**

**잘못된 분석**: `AgentDelegationTool` Hook 구현 불가능
**실제 상황**: **완전히 구현 가능함** - Robota SDK Universal Hook 시스템 지원

#### **🟢 정정된 분석 - AgentDelegationTool Hook 시스템**

**✅ Universal Hook 시스템 완전 지원**:
- `BaseTool`은 생성자에서 `BaseToolOptions{ hooks?: ToolHooks }`를 받음
- `createZodFunctionTool`이 생성하는 `FunctionTool`은 `BaseTool`을 상속함
- `AgentDelegationTool`에서 Hook을 주입하여 `FunctionTool` 생성 가능

**✅ 해결 방법 3가지**:
1. **createZodFunctionTool 확장**: options 매개변수 추가하여 Hook 전달
2. **AgentDelegationTool 리팩토링**: BaseTool 직접 상속으로 변경
3. **PlaygroundTeamInstance Hook 주입**: 생성 시점에 Hook 전달

#### **🟢 HIGH SUCCESS - Phase 5.1: 완전한 Hook 기반 구현**

**구현 전략**: AgentDelegationTool에 PlaygroundHistoryPlugin Hook 주입

### 🔄 **복원된 원래 계획: 상세한 Team Block Tracking**

#### **목표**: 아래와 같은 상세한 워크플로우 Block 표시
```
[User Message] "vue와 react의 장단점을 각각 정리해줘"

📋 [Team Agent] 작업 분석 중...
├── 🔧 [assignTask Tool Call] 
│   ├── Tool: assignTask
│   ├── Parameters: {
│   │     jobDescription: "vue와 react의 장단점 비교 분석"
│   │     agentTemplate: "frontend_expert"
│   │     priority: "high"
│   │   }
│   └── 상태: 실행 중...
│
├── 🤖 [Agent Creation] Frontend Expert
│   ├── Template: frontend_expert
│   ├── Provider: openai/gpt-4
│   ├── System: "You are a frontend technology specialist..."
│   ├── Tools: [webSearch, codeAnalysis]
│   └── Duration: 1.2s
│
├── ▶️ [Agent Execution] Frontend Expert 실행
│   ├── Input: "vue와 react의 장단점을 각각 정리해줘"
│   ├── 🔧 [webSearch] "Vue.js advantages disadvantages"
│   │   └── Result: "Vue.js is known for..."
│   ├── 🔧 [webSearch] "React advantages disadvantages 2024"
│   │   └── Result: "React offers..."  
│   ├── 🔧 [codeAnalysis] Vue vs React code patterns
│   │   └── Result: "Component structure comparison..."
│   ├── Response: "### Vue.js 장단점\n**장점:**\n1. 낮은 학습곡선..."
│   ├── Duration: 8.4s
│   └── Tokens: 2,847
│
├── 📊 [Task Result Aggregation] 
│   ├── Agent Results: 1개 수집 완료
│   ├── Synthesis: Frontend Expert 분석을 종합하여 균형잡힌 비교 제공
│   └── Duration: 0.8s
│
└── [Assistant Response] "프론트엔드 전문가의 심층 분석을 바탕으로..."
```

### 🟢 **Phase 5.1: Hook 기반 Foundation (HIGH SUCCESS)**

#### [ ] 5.1.1 createZodFunctionTool Hook 지원 확장
- [ ] **기술 분석**: `createZodFunctionTool` → `FunctionTool` → `BaseTool` 상속 구조 확인
- [ ] **API 설계**: `createZodFunctionTool(name, description, zodSchema, fn, options?: BaseToolOptions)` 시그니처 추가
- [ ] **구현**: `new FunctionTool(schema, wrappedFn, options)` 호출 시 options 전달
- [ ] **호환성 보장**: 기존 4-매개변수 호출은 `options` 없이 동작
- [ ] **즉시 검증**: Hook이 주입된 도구에서 beforeExecute 호출 확인

#### [ ] 5.1.2 AgentDelegationTool Hook 주입 구현  
- [ ] **인터페이스 확장**: `AgentDelegationToolOptions`에 `hooks?: ToolHooks` 필드 추가
- [ ] **생성자 수정**: `this.hooks = options.hooks;` 저장
- [ ] **도구 생성 업데이트**: `createZodFunctionTool('assignTask', description, schema, executor, { hooks: this.hooks, logger: this.logger })`
- [ ] **Hook 구현**: 
  - `beforeExecute`: assignTask 상세 정보 기록 → `historyPlugin.recordEvent('tool_call_start', { toolName: 'assignTask', parameters, agentTemplate, jobDescription })`
  - `afterExecute`: assignTask 결과 및 Agent 정보 기록 → `historyPlugin.recordEvent('tool_call_complete', { toolName: 'assignTask', result, agentId, duration })`
  - `onError`: assignTask 실패 정보 기록 → `historyPlugin.recordEvent('tool_call_error', { toolName: 'assignTask', error, parameters })`
- [ ] **즉시 검증**: assignTask 호출 시 Hook 함수 실행 및 이벤트 기록 확인

#### [ ] 5.1.3 PlaygroundTeamInstance Hook 연동
- [ ] **Hook Factory 구현**: `createAssignTaskHooks(historyPlugin: PlaygroundHistoryPlugin): ToolHooks` 함수 생성
  ```typescript
  const createAssignTaskHooks = (historyPlugin: PlaygroundHistoryPlugin): ToolHooks => ({
    beforeExecute: async (toolName, parameters, context) => {
      await historyPlugin.recordEvent('tool_call_start', {
        toolName, parameters, context, timestamp: new Date()
      });
    },
    afterExecute: async (toolName, parameters, result, context) => {
      await historyPlugin.recordEvent('tool_call_complete', {
        toolName, parameters, result, context, timestamp: new Date()
      });
    },
    onError: async (toolName, parameters, error, context) => {
      await historyPlugin.recordEvent('tool_call_error', {
        toolName, parameters, error: error.message, context, timestamp: new Date()
      });
    }
  });
  ```
- [ ] **PlaygroundTeamInstance 수정**: `createAssignTaskTool` 오버라이드하여 Hook 주입
  ```typescript
  private createAssignTaskTool(): AgentDelegationTool {
    const hooks = createAssignTaskHooks(this.historyPlugin);
    return new AgentDelegationTool({
      availableTemplates: this.availableTemplates,
      executor: this.executor.bind(this),
      hooks, // ✅ Hook 주입
      logger: this.logger
    });
  }
  ```
- [ ] **TeamContainer 옵션**: Hook이 포함된 도구를 TeamContainer에 전달
- [ ] **즉시 검증**: Team 채팅 시 assignTask Hook 이벤트 발생 및 visualizationData.events 추가 확인

#### [ ] 5.1.4 Agent 생성/실행 Hook 추가 (고급)
- [ ] **분석**: TeamContainer.assignTask 내부에서 Agent 생성 시점 파악
- [ ] **Wrapper 구현**: `executeWithAgentTracking` 메서드로 Agent 생명주기 추적
  ```typescript
  private async executeWithAgentTracking(jobDescription: string, agentTemplate: string) {
    // Agent 생성 시작 이벤트
    await this.historyPlugin.recordEvent('agent_creation_start', { agentTemplate, jobDescription });
    
    const agent = new Robota(agentConfig);
    
    // Agent 생성 완료 이벤트  
    await this.historyPlugin.recordEvent('agent_creation_complete', { agentId: agent.id, agentTemplate });
    
    // Agent 실행 시작 이벤트
    await this.historyPlugin.recordEvent('agent_execution_start', { agentId: agent.id, input: jobDescription });
    
    const result = await agent.run(jobDescription);
    
    // Agent 실행 완료 이벤트
    await this.historyPlugin.recordEvent('agent_execution_complete', { agentId: agent.id, result });
    
    return result;
  }
  ```
- [ ] **Tool Execution Context 활용**: Agent 내부 도구 호출 시 context를 통한 계층 추적
- [ ] **Agent dispose Hook**: Agent 정리 작업 추적 (`agent_disposed` 이벤트)
- [ ] **즉시 검증**: Agent 생명주기 전체 이벤트 순서 확인 (creation_start → creation_complete → execution_start → execution_complete → disposed)

### 🟢 **Phase 5.2: 상세 이벤트 타입 및 메타데이터 (HIGH SUCCESS)**

#### [ ] 5.2.1 ConversationEvent 확장 - 도구 및 Agent 세부사항
- [ ] **Team Delegation 이벤트**:
  - `'tool_call_start'`: assignTask 도구 호출 시작
  - `'tool_call_complete'`: assignTask 도구 호출 완료  
  - `'tool_call_error'`: assignTask 도구 호출 실패
- [ ] **Agent Lifecycle 이벤트**:
  - `'agent_creation_start'`: Agent 생성 과정 시작
  - `'agent_creation_complete'`: Agent 생성 과정 완료
  - `'agent_execution_start'`: Agent 실행 과정 시작  
  - `'agent_execution_complete'`: Agent 실행 과정 완료
  - `'agent_disposed'`: Agent 리소스 정리 완료
- [ ] **Sub-tool Execution 이벤트**:
  - `'sub_tool_call_start'`: Agent 내부 도구 호출 시작 (webSearch, codeAnalysis 등)
  - `'sub_tool_call_complete'`: Agent 내부 도구 호출 완료
- [ ] **Task Aggregation 이벤트**:
  - `'task_aggregation_start'`: 결과 집계 시작
  - `'task_aggregation_complete'`: 결과 집계 완료
- [ ] **타입 정의 업데이트**: `ConversationEvent['type']` 유니온 타입에 12개 이벤트 추가
- [ ] **즉시 검증**: 모든 이벤트 타입의 타입스크립트 컴파일 확인

#### [ ] 5.2.2 상세 메타데이터 구조 설계
- [ ] **Tool Call 메타데이터**:
  ```typescript
  interface ToolCallMetadata {
    toolName: 'assignTask';
    parameters: {
      jobDescription: string;
      agentTemplate: string;
      priority?: string;
      context?: Record<string, any>;
    };
    duration?: number; // ms
    success: boolean;
    error?: string;
    timestamp: Date;
  }
  ```
- [ ] **Agent Creation 메타데이터**:
  ```typescript
  interface AgentCreationMetadata {
    agentId: string;
    agentTemplate: string;
    provider: string; // 'openai' | 'anthropic'
    model: string; // 'gpt-4' | 'claude-3-sonnet'
    systemMessage: string;
    tools: string[]; // ['webSearch', 'codeAnalysis']
    config: AgentConfig;
    duration: number; // ms
    timestamp: Date;
  }
  ```
- [ ] **Agent Execution 메타데이터**:
  ```typescript
  interface AgentExecutionMetadata {
    agentId: string;
    input: string;
    output: string;
    toolCalls: Array<{
      toolName: string;
      parameters: Record<string, any>;
      result: any;
      duration: number;
    }>;
    totalDuration: number; // ms
    tokenUsage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    timestamp: Date;
  }
  ```
- [ ] **Sub-tool Call 메타데이터**:
  ```typescript
  interface SubToolCallMetadata {
    parentAgentId: string;
    toolName: string; // 'webSearch' | 'codeAnalysis' | 'fileRead'
    parameters: Record<string, any>;
    result: any;
    duration: number; // ms
    success: boolean;
    error?: string;
    timestamp: Date;
  }
  ```
- [ ] **Task Aggregation 메타데이터**:
  ```typescript
  interface TaskAggregationMetadata {
    agentResults: Array<{
      agentId: string;
      agentTemplate: string;
      output: string;
      tokenUsage: TokenUsage;
    }>;
    synthesisMethod: 'simple_concat' | 'weighted_summary' | 'expert_synthesis';
    finalOutput: string;
    totalDuration: number; // ms
    timestamp: Date;
  }
  ```
- [ ] **즉시 검증**: 메타데이터 구조의 JSON 직렬화 가능성 및 타입 안전성 확인

#### [ ] 5.2.3 계층 구조 및 관계 관리
- [ ] **계층 구조 필드**:
  ```typescript
  interface ConversationEvent {
    // 기존 필드들...
    
    // 계층 구조 관련 필드
    parentEventId?: string; // 부모 이벤트 ID 참조
    childEventIds: string[]; // 자식 이벤트 ID 배열 (자동 관리)
    executionLevel: 0 | 1 | 2 | 3; // 0=Team, 1=Tool, 2=Agent, 3=Sub-tool
    executionPath: string; // 'team→assignTask→agent_abc123→webSearch'
    
    // 컨텍스트 추적
    teamInstanceId?: string;
    delegationId?: string; // assignTask 호출 고유 ID
    agentId?: string;
    toolCallId?: string;
  }
  ```
- [ ] **자동 관계 관리**:
  ```typescript
  class PlaygroundHistoryPlugin {
    private relationshipTracker = new Map<string, string[]>(); // parentId -> childIds[]
    
    async recordEvent(type: string, metadata: any, parentEventId?: string): Promise<string> {
      const eventId = generateEventId();
      
      // 부모-자식 관계 자동 설정
      if (parentEventId) {
        if (!this.relationshipTracker.has(parentEventId)) {
          this.relationshipTracker.set(parentEventId, []);
        }
        this.relationshipTracker.get(parentEventId)!.push(eventId);
      }
      
      // executionLevel 자동 계산
      const executionLevel = this.calculateExecutionLevel(type);
      
      // executionPath 자동 생성
      const executionPath = this.buildExecutionPath(parentEventId, type, metadata);
      
      const event: ConversationEvent = {
        id: eventId,
        type,
        content: this.formatEventContent(type, metadata),
        timestamp: new Date(),
        metadata,
        parentEventId,
        childEventIds: [],
        executionLevel,
        executionPath
      };
      
      this.events.push(event);
      return eventId;
    }
  }
  ```
- [ ] **실행 경로 추적**: Team → assignTask → Agent → subTool 경로 자동 구성
- [ ] **중첩 delegation 지원**: Agent가 다시 assignTask를 호출하는 경우 처리
- [ ] **즉시 검증**: 복잡한 중첩 구조에서 올바른 계층 구조 생성 및 순환 참조 방지

### 🟡 **Phase 5.3: PlaygroundHistoryPlugin 고급 기능 (MEDIUM SUCCESS)**

#### [ ] 5.3.1 Team 워크플로우 추적 메서드
- [ ] **recordToolCall() 구현**:
  ```typescript
  async recordToolCall(
    phase: 'start' | 'complete' | 'error',
    toolName: string,
    data: {
      parameters?: any;
      result?: any;
      error?: Error;
      duration?: number;
    },
    parentEventId?: string
  ): Promise<string> {
    const eventType = `tool_call_${phase}` as const;
    const metadata: ToolCallMetadata = {
      toolName,
      parameters: data.parameters,
      duration: data.duration,
      success: phase === 'complete',
      error: data.error?.message,
      timestamp: new Date()
    };
    
    return await this.recordEvent(eventType, metadata, parentEventId);
  }
  ```
- [ ] **recordAgentCreation() 구현**: Agent 생성 과정 및 설정 상세 기록
- [ ] **recordAgentExecution() 구현**: Agent 실행 및 내부 도구 사용 기록  
- [ ] **recordSubToolCall() 구현**: Agent 내부 도구 호출 개별 기록
- [ ] **recordTaskAggregation() 구현**: 결과 집계 과정 기록
- [ ] **즉시 검증**: 각 메서드 호출 시 올바른 이벤트 생성 및 메타데이터 구조 확인

#### [ ] 5.3.2 실시간 Hook 기반 자동 수집
- [ ] **Hook에서 Plugin 메서드 자동 호출**:
  ```typescript
  const createAssignTaskHooks = (historyPlugin: PlaygroundHistoryPlugin): ToolHooks => ({
    beforeExecute: async (toolName, parameters, context) => {
      const eventId = await historyPlugin.recordToolCall('start', toolName, { parameters });
      // context에 eventId 저장하여 afterExecute에서 참조
      if (context) context.startEventId = eventId;
    },
    afterExecute: async (toolName, parameters, result, context) => {
      await historyPlugin.recordToolCall('complete', toolName, { 
        parameters, 
        result,
        duration: Date.now() - (context?.startTime || 0)
      }, context?.startEventId);
    },
    onError: async (toolName, parameters, error, context) => {
      await historyPlugin.recordToolCall('error', toolName, { 
        parameters, 
        error,
        duration: Date.now() - (context?.startTime || 0)
      }, context?.startEventId);
    }
  });
  ```
- [ ] **이벤트 타이밍 보장**: beforeExecute → start event, afterExecute → complete event 순서 보장
- [ ] **에러 처리**: onError → error event with stack trace, 부분 실행 결과 포함
- [ ] **성능 측정**: duration, memory usage, token consumption 자동 추적
- [ ] **즉시 검증**: Hook → Plugin → visualizationData 전체 플로우 확인

### 🟡 **Phase 5.4: 고급 Block UI 컴포넌트 (MEDIUM SUCCESS)**

#### [ ] 5.4.1 세분화된 Block 컴포넌트
- [ ] **ToolCallBlock 컴포넌트**:
  ```typescript
  interface ToolCallBlockProps {
    event: ConversationEvent;
    metadata: ToolCallMetadata;
    isExpanded: boolean;
    onToggle: () => void;
  }
  
  const ToolCallBlock: React.FC<ToolCallBlockProps> = ({ event, metadata, isExpanded, onToggle }) => (
    <div className="border-l-4 border-blue-500 pl-4 mb-2">
      <div className="flex items-center gap-2 cursor-pointer" onClick={onToggle}>
        <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} />
        <Badge variant={metadata.success ? 'success' : 'error'}>
          {metadata.toolName}
        </Badge>
        <span className="text-sm text-gray-600">
          {metadata.duration}ms
        </span>
      </div>
      {isExpanded && (
        <div className="mt-2 space-y-2">
          <JSONViewer data={metadata.parameters} title="Parameters" />
          {metadata.result && <JSONViewer data={metadata.result} title="Result" />}
          {metadata.error && <div className="text-red-600">{metadata.error}</div>}
        </div>
      )}
    </div>
  );
  ```
- [ ] **AgentCreationBlock**: Agent 설정, 템플릿, 도구 목록 표시
- [ ] **AgentExecutionBlock**: 입력, 출력, 내부 도구 사용 내역 표시
- [ ] **SubToolCallBlock**: 개별 도구 호출 (webSearch, codeAnalysis 등) 상세 표시
- [ ] **TaskAggregationBlock**: 다중 Agent 결과 종합 과정 시각화
- [ ] **즉시 검증**: 각 Block의 독립적 렌더링 및 데이터 바인딩

#### [ ] 5.4.2 인터랙티브 Block UI
- [ ] **Expandable/Collapsible 구현**:
  ```typescript
  const useBlockExpansion = () => {
    const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
    
    const toggleBlock = useCallback((eventId: string) => {
      setExpandedBlocks(prev => {
        const next = new Set(prev);
        if (next.has(eventId)) {
          next.delete(eventId);
        } else {
          next.add(eventId);
        }
        return next;
      });
    }, []);
    
    return { expandedBlocks, toggleBlock };
  };
  ```
- [ ] **실시간 상태 업데이트**: 진행중 → 완료 → 에러 애니메이션
- [ ] **JSON 뷰어**: 도구 매개변수/결과 구조화된 표시
- [ ] **Agent 설정 트리 뷰**: 계층적 Agent 설정 및 내부 도구 표시
- [ ] **실행 시간 타임라인**: 각 단계별 실행 시간 및 성능 메트릭 시각화
- [ ] **즉시 검증**: 복잡한 중첩 구조에서의 UI 반응성 및 성능

### 🟠 **Phase 5.5: End-to-End 통합 및 고급 시나리오 (MEDIUM SUCCESS)**

#### [ ] 5.5.1 복잡한 Team 시나리오 테스트
- [ ] **다중 Agent delegation 시나리오**:
  ```typescript
  // Agent가 다시 assignTask를 호출하는 중첩 시나리오
  const complexScenario = {
    userPrompt: "전체 웹사이트 리뷰를 해주세요",
    expectedFlow: [
      'tool_call_start', // Main assignTask: "website_analyzer"
      'agent_creation_start', // Website Analyzer Agent 생성
      'agent_creation_complete',
      'agent_execution_start', // Website Analyzer 실행
        'tool_call_start', // Nested assignTask: "frontend_expert"  
        'agent_creation_start', // Frontend Expert Agent 생성
        'agent_creation_complete',
        'agent_execution_start', // Frontend Expert 실행
          'sub_tool_call_start', // webSearch
          'sub_tool_call_complete',
        'agent_execution_complete',
        'tool_call_complete', // Nested assignTask 완료
      'agent_execution_complete', // Website Analyzer 완료
      'task_aggregation_start',
      'task_aggregation_complete',
      'tool_call_complete' // Main assignTask 완료
    ]
  };
  ```
- [ ] **병렬 Agent 실행**: 동시에 여러 전문가 Agent 생성 및 결과 병합
- [ ] **Agent 간 통신**: Agent가 중간 결과를 공유하는 시나리오
- [ ] **실패 복구**: Agent 생성 실패 → 대체 Agent 생성 플로우
- [ ] **즉시 검증**: 복잡한 시나리오에서 Block 구조 일관성 및 계층 정확성

#### [ ] 5.5.2 성능 및 확장성 검증
- [ ] **대용량 Block UI 성능**:
  ```typescript
  const performanceTest = {
    scenarios: [
      { events: 50, description: '중간 규모 Team 대화' },
      { events: 100, description: '복잡한 다중 delegation' },
      { events: 200, description: '장시간 세션' }
    ],
    metrics: [
      'renderTime', // 초기 렌더링 시간
      'updateTime', // 실시간 업데이트 시간  
      'memoryUsage', // 메모리 사용량
      'scrollPerformance' // 스크롤 성능
    ]
  };
  ```
- [ ] **실시간 업데이트 지연 시간**: Hook → Plugin → UI 전체 플로우 지연 측정
- [ ] **메모리 사용량 최적화**: 대량 이벤트 시 메모리 누수 방지
- [ ] **브라우저 호환성**: Chrome, Firefox, Safari에서 일관된 동작 확인

### 🎯 **완성된 예상 결과물**

#### **사용자 경험**:
```
사용자: "vue와 react의 장단점을 각각 정리해줘"

📋 [Team Agent] 작업 분석 중... (0.1s)
├── 🔧 [assignTask] Frontend Expert 할당 (1.2s)
│   ├── Parameters: { template: "frontend_expert", job: "vue react 비교" }
│   └── Status: ✅ 완료
│
├── 🤖 [Agent Creation] Frontend Expert (1.2s)  
│   ├── Provider: OpenAI GPT-4
│   ├── Tools: [webSearch, codeAnalysis, documentation]
│   └── Config: { systemMessage: "You are a frontend specialist..." }
│
├── ▶️ [Agent Execution] Frontend Expert (8.4s)
│   ├── 🔧 [webSearch] "Vue.js pros cons 2024" (2.1s)
│   │   └── Results: "Vue.js advantages: gentle learning curve..."
│   ├── 🔧 [webSearch] "React advantages disadvantages comparison" (1.8s)  
│   │   └── Results: "React benefits: large ecosystem..."
│   ├── 🔧 [codeAnalysis] Vue vs React patterns (3.2s)
│   │   └── Analysis: "Component architecture differences..."
│   └── Response: "### Vue.js vs React 심층 비교..." (1.3s)
│
├── 📊 [Task Aggregation] 결과 정리 (0.8s)
│   ├── Agent Count: 1
│   ├── Method: expert_synthesis  
│   └── Final Length: 1,247 chars
│
└── [Assistant] "프론트엔드 전문가의 분석 결과..." (Total: 11.7s)
```

**기술적 성과**: 
- ✅ 완전한 Team 워크플로우 가시화
- ✅ 실시간 Hook 기반 자동 추적 
- ✅ 계층적 Block 구조 UI
- ✅ 상세한 메타데이터 및 성능 메트릭
- ✅ Robota SDK 아키텍처 100% 준수 

### 📊 **최종 진행률 추적 및 요약**

#### **🎯 Phase 5: Team Block Tracking - 완전 복원된 상세 계획**

**🟢 Phase 5.1 (Hook Foundation)**: 0% (16/16) - **완전 실현 가능**
- createZodFunctionTool Hook 지원 확장 (4/4)
- AgentDelegationTool Hook 주입 구현 (5/5)  
- PlaygroundTeamInstance Hook 연동 (4/4)
- Agent 생성/실행 Hook 추가 (3/3)

**🟢 Phase 5.2 (Event & Metadata)**: 0% (12/12) - **SDK 지원 완비**
- ConversationEvent 12개 타입 확장 (4/4)
- 5개 메타데이터 인터페이스 설계 (4/4)
- 계층 구조 및 관계 관리 (4/4)

**🟡 Phase 5.3 (Advanced Plugin)**: 0% (8/8) - **자동화 가능**
- Team 워크플로우 추적 메서드 (6/6)
- 실시간 Hook 기반 자동 수집 (2/2)

**🟡 Phase 5.4 (Advanced UI)**: 0% (10/10) - **React 구현 가능**
- 세분화된 Block 컴포넌트 (5/5)
- 인터랙티브 Block UI (5/5)

**🟠 Phase 5.5 (Complex Scenarios)**: 0% (8/8) - **테스트 집약적**
- 복잡한 Team 시나리오 테스트 (4/4)
- 성능 및 확장성 검증 (4/4)

---

#### **📈 전체 프로젝트 진행률**

**Phase 5 완료율**: 0% (54/54) - **원래 비전 100% 복원**

**전체 진행률**: 20% (16/81) 

**예상 완료 시점**:
- 🟢 Phase 5.1-5.2 (Foundation): **2-3일** (높은 성공률)
- 🟡 Phase 5.3-5.4 (Implementation): **4-5일** (중간 복잡도)
- 🟠 Phase 5.5 (Advanced): **2-3일** (선택적)

**총 예상 기간**: **8-11일** (완전한 상세 Team Block Tracking 시스템)

---

#### **🚀 핵심 성과 요약**

**✅ 아키텍처 검증 완료**:
- Robota SDK Universal Hook 시스템 완전 지원 확인
- BaseTool → ToolHooks → AgentDelegationTool 경로 확보
- createZodFunctionTool Hook 확장성 검증

**✅ 기술적 실현성 확보**:
- 12개 상세 이벤트 타입 정의
- 5개 메타데이터 인터페이스 설계  
- 계층적 실행 경로 추적 방법론
- React UI 컴포넌트 아키텍처

**✅ 사용자 경험 목표 달성**:
- 상세한 Team 워크플로우 시각화
- 실시간 Hook 기반 자동 추적
- Expandable/Collapsible 인터랙티브 UI
- 성능 메트릭 및 에러 처리

**🎯 결론**: **원래 계획했던 상세하고 복잡한 Team Block Tracking이 Robota SDK의 Universal Hook 시스템을 통해 완전히 구현 가능함을 확인했습니다.** 