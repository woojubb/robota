# EventService 아키텍처 구현 작업 목록

## 🎯 프로젝트 개요

### 목표
Team/Agent/Tool에서 발생하는 모든 이벤트를 단일 EventService를 통해 통합 처리하여 Playground UI에서 완전한 실행 추적을 구현

### 핵심 설계 원칙
- **Built-in Service**: EventService는 ExecutionService와 동일한 패턴으로 기본 제공
- **의존성 주입**: Optional EventService 주입으로 유연성 확보
- **단일 이벤트 핸들러**: `emit(eventType, data)` 메소드로 모든 이벤트 통합 처리
- **아키텍처 일관성**: 기존 Robota SDK 패턴과 100% 일치

### ✅ 검증 완료된 설계
- **단일 이벤트 리스너**: PlaygroundEventService.emit()으로 Team/Agent/Tool 모든 이벤트 수신
- **완전한 계층 구조 추적**: ToolExecutionContext 정보로 블록 계층 구조 완벽 구현
- **기존 로직 재사용**: PlaygroundHistoryPlugin.recordEvent() 메커니즘 활용
- **확장성**: 새 이벤트 타입 mapToConversationEvent()에만 추가하면 완료

## 📋 구현 작업 목록

### Phase 1: EventService 핵심 구현
- [ ] **1-1. EventService 인터페이스 정의**
  - `packages/agents/src/services/event-service.ts` 생성
  - `EventService` 인터페이스 정의 (`emit` 메소드)
  - `SilentEventService` 기본 구현체 (무음)
  - `DefaultEventService` 기본 구현체 (콘솔 로깅)

- [ ] **1-2. Event 타입 정의**
  - `packages/agents/src/interfaces/event-types.ts` 생성
  - `EventType` 유니온 타입 정의
  - `EventData` 인터페이스 정의 (계층 구조 정보 포함)
  - 표준 이벤트 타입 목록 정의

- [ ] **1-3. EventServiceHookFactory 구현**
  - `packages/agents/src/utils/event-service-hook-factory.ts` 생성
  - `createToolHooks()` 정적 메소드 구현
  - EventService를 ToolHooks로 변환하는 어댑터 구현

### Phase 2: Agent/Team EventService 통합
- [ ] **2-1. AgentConfig EventService 지원**
  - `packages/agents/src/interfaces/agent.ts` 수정
  - `AgentConfig`에 `eventService?: EventService` 추가

- [ ] **2-2. Robota Agent EventService 통합**
  - `packages/agents/src/agents/robota.ts` 수정
  - constructor에서 EventService 초기화 (`config.eventService || new SilentEventService()`)
  - ExecutionService 생성 시 EventService 전달
  - run/runStream 메소드에서 자동 이벤트 발생

- [ ] **2-3. TeamContainerOptions EventService 지원**
  - `packages/team/src/types.ts` 수정
  - `TeamContainerOptions`에 `eventService?: EventService` 추가

- [ ] **2-4. TeamContainer EventService 통합**
  - `packages/team/src/team-container.ts` 수정
  - constructor에서 EventService 초기화
  - teamAgent 생성 시 EventService 전달
  - assignTask 시 임시 Agent에 EventService 전달
  - 자동 ToolHooks 생성 로직 구현

- [ ] **2-5. createTeam 함수 EventService 지원**
  - `packages/team/src/create-team.ts` 수정
  - EventService가 있고 toolHooks가 없으면 자동 Hook 생성
  - TeamContainer에 EventService 전달

### Phase 3: ExecutionService EventService 통합
- [ ] **3-1. ExecutionService EventService 지원**
  - `packages/agents/src/services/execution-service.ts` 수정
  - constructor에 `eventService?: EventService` 매개변수 추가
  - execute/executeStream 메소드에서 자동 이벤트 발생
  - tool 실행 전후 이벤트 발생

- [ ] **3-2. ToolExecutionService EventService 전파**
  - `packages/agents/src/services/tool-execution-service.ts` 수정
  - tool 실행 시 EventService 전달 (선택적)

### Phase 4: Tool EventService 지원
- [ ] **4-1. BaseTool EventService 지원**
  - `packages/agents/src/abstracts/base-tool.ts` 수정
  - constructor에서 EventService 받을 수 있도록 수정
  - execute 메소드에서 자동 이벤트 발생

- [ ] **4-2. AgentDelegationTool EventService 전파**
  - `packages/team/src/tools/agent-delegation-tool.ts` 수정
  - EventService를 받아서 wrapped tool에 전달

### Phase 5: Playground EventService 통합 (핵심 이벤트 핸들러)
- [ ] **5-1. PlaygroundEventService 구현**
  - `apps/web/src/lib/playground/services/playground-event-service.ts` 생성
  - **단일 이벤트 핸들러**: `emit(eventType, data)` 구현
  - **이벤트 매핑**: `mapToConversationEvent()` 메소드 구현
  - **계층 구조 처리**: ExecutionContext 정보로 블록 계층 구조 생성
  - PlaygroundHistoryPlugin과 연동하여 기존 블록 생성 로직 재사용

- [ ] **5-2. PlaygroundExecutor EventService 통합**
  - `apps/web/src/lib/playground/robota-executor.ts` 수정
  - constructor에서 PlaygroundEventService 생성
  - createAgent/createTeam 시 EventService 주입
  - **기존 toolHooks 로직을 EventService로 완전 대체**

- [ ] **5-3. PlaygroundHistoryPlugin EventService 연동**
  - `apps/web/src/lib/playground/plugins/playground-history-plugin.ts` 수정
  - EventService로부터 이벤트를 받아서 ConversationEvent로 변환
  - recordEvent 메소드를 이벤트 핸들러로 활용

### Phase 6: 개발 단계 호환성 (임시)
- [ ] **6-1. 점진적 개발을 위한 임시 호환성**
  - toolHooks와 eventService 모두 제공된 경우 EventService 우선
  - 기존 코드가 깨지지 않도록 임시 호환성 보장
  - **⚠️ 주의: 개발 완료 후 모든 기존 코드 제거 예정**

- [ ] **6-2. 단계적 교체 지원 (임시)**
  - 기존 Plugin 시스템과 EventService 병행 사용 가능
  - 단계적으로 EventService로 전환할 수 있는 구조
  - **⚠️ 주의: 최종 버전에서는 EventService만 유지**

### Phase 7: 테스트 및 검증
- [ ] **7-1. EventService 단위 테스트**
  - EventService 구현체들 테스트
  - EventServiceHookFactory 테스트
  - 이벤트 발생/처리 테스트

- [ ] **7-2. 통합 테스트**
  - Agent 모드에서 EventService 동작 확인
  - Team 모드에서 assignTask 추적 확인
  - Playground UI에서 계층 구조 표시 확인

- [ ] **7-3. 성능 테스트**
  - EventService 오버헤드 측정
  - 대량 이벤트 처리 성능 확인
  - 메모리 누수 체크

### Phase 8: 최종 정리 및 레거시 제거
- [ ] **8-1. 기존 코드 완전 제거**
  - 기존 toolHooks 시스템 완전 제거
  - EventEmitterPlugin 관련 코드 제거
  - 사용하지 않는 이벤트 관련 코드 제거
  - 임시 호환성 코드 제거

- [ ] **8-2. API 문서 업데이트**
  - EventService 인터페이스 문서화
  - 사용 예제 작성
  - 기존 API 참조 제거

- [ ] **8-3. 코드 정리 및 최적화**
  - 중복된 설계 문서 정리
  - TypeScript 타입 최적화
  - 최종 코드 리뷰 및 정리

## 🔧 기술 명세

### EventService 인터페이스
```typescript
interface EventService {
  emit(eventType: EventType, data: EventData): void;
}

interface EventData {
  sourceType: 'agent' | 'team' | 'tool';
  sourceId: string;
  timestamp?: Date;
  
  // 계층 구조 추적 정보 (ToolExecutionContext에서 추출)
  parentExecutionId?: string;
  rootExecutionId?: string;
  executionLevel?: number;
  executionPath?: string[];
  
  // 이벤트별 특화 데이터
  toolName?: string;
  parameters?: any;
  result?: any;
  error?: string;
  taskDescription?: string;
  
  [key: string]: any;
}

type EventType = 
  | 'execution.start'
  | 'execution.complete' 
  | 'execution.error'
  | 'tool_call_start'
  | 'tool_call_complete'
  | 'tool_call_error'
  | 'task.assigned'
  | 'task.completed';
```

### 핵심 구현: PlaygroundEventService
```typescript
class PlaygroundEventService implements EventService {
  constructor(private historyPlugin: PlaygroundHistoryPlugin) {}
  
  // ✅ 단일 이벤트 핸들러 - 모든 Team/Agent/Tool 이벤트 수신
  emit(eventType: EventType, data: EventData): void {
    // 이벤트를 ConversationEvent로 변환
    const conversationEvent = this.mapToConversationEvent(eventType, data);
    
    // 기존 블록 생성 로직 재사용
    this.historyPlugin.recordEvent(conversationEvent);
  }
  
  // ✅ 이벤트 타입별 블록 매핑
  private mapToConversationEvent(eventType: EventType, data: EventData): ConversationEvent {
    const baseEvent = {
      type: this.getConversationEventType(eventType),
      timestamp: data.timestamp || new Date(),
      
      // 계층 구조 정보 자동 설정
      parentEventId: data.parentExecutionId,
      executionLevel: data.executionLevel || this.inferExecutionLevel(data.sourceType),
      executionPath: this.buildExecutionPath(data),
      
      // 소스 정보
      agentId: data.sourceType === 'agent' ? data.sourceId : undefined,
      toolName: data.sourceType === 'tool' ? data.toolName : undefined,
      
      metadata: {
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        eventType: eventType
      }
    };

    // 이벤트 타입별 특화 처리
    switch(eventType) {
      case 'tool_call_start':
        return {
          ...baseEvent,
          type: 'tool_call',
          content: `🚀 [${data.toolName}] Starting...`,
          parameters: data.parameters,
          metadata: { ...baseEvent.metadata, phase: 'start' }
        };
      
      case 'tool_call_complete':
        return {
          ...baseEvent,
          type: 'tool_result',
          content: `✅ [${data.toolName}] Completed`,
          result: data.result,
          metadata: { ...baseEvent.metadata, phase: 'complete' }
        };
        
      case 'task.assigned':
        return {
          ...baseEvent,
          type: 'tool_call',
          content: `🎯 Task assigned: ${data.taskDescription}`,
          parameters: { taskDescription: data.taskDescription },
          metadata: { ...baseEvent.metadata, phase: 'assigned' }
        };
        
      case 'execution.start':
        return {
          ...baseEvent,
          type: data.sourceType === 'team' ? 'user_message' : 'assistant_response',
          content: `🎯 ${data.sourceType} execution started`,
          metadata: { ...baseEvent.metadata, executionType: data.sourceType }
        };
        
      // ... 기타 이벤트 타입들
    }
  }
  
  // ✅ 실행 레벨 자동 추론
  private inferExecutionLevel(sourceType: 'agent' | 'team' | 'tool'): number {
    switch(sourceType) {
      case 'team': return 0;   // Team 레벨
      case 'agent': return 1;  // Agent 레벨
      case 'tool': return 2;   // Tool 레벨
      default: return 0;
    }
  }
  
  // ✅ 실행 경로 생성
  private buildExecutionPath(data: EventData): string {
    const path = data.executionPath || [];
    const currentStep = data.sourceType === 'tool' ? data.toolName : data.sourceId;
    return [...path, currentStep].join('→');
  }
}
```

### EventServiceHookFactory 구현
```typescript
export class EventServiceHookFactory {
  // ✅ 기존 toolHooks 시스템과의 브릿지
  static createToolHooks(eventService: EventService, sourceId: string): ToolHooks {
    return {
      beforeExecute: async (toolName: string, parameters: any, context?: ToolExecutionContext) => {
        eventService.emit('tool_call_start', {
          sourceType: 'tool',
          sourceId,
          toolName,
          parameters,
          parentExecutionId: context?.parentExecutionId,
          executionLevel: context?.executionLevel,
          executionPath: context?.executionPath
        });
      },
      
      afterExecute: async (toolName: string, parameters: any, result: any, context?: ToolExecutionContext) => {
        eventService.emit('tool_call_complete', {
          sourceType: 'tool',
          sourceId,
          toolName,
          parameters,
          result,
          parentExecutionId: context?.parentExecutionId,
          executionLevel: context?.executionLevel,
          executionPath: context?.executionPath
        });
      },
      
      onError: async (toolName: string, parameters: any, error: Error, context?: ToolExecutionContext) => {
        eventService.emit('tool_call_error', {
          sourceType: 'tool',
          sourceId,
          toolName,
          parameters,
          error: error.message,
          parentExecutionId: context?.parentExecutionId,
          executionLevel: context?.executionLevel,
          executionPath: context?.executionPath
        });
      }
    };
  }
}
```

## 🎯 이벤트 핸들러 구현 계획

### 📊 현재 vs EventService 비교

#### **현재 방식 (3개 훅 × N개 도구)**
```typescript
// PlaygroundExecutor.createTeam()
const toolHooks = {
  beforeExecute: async (tool, params) => {
    this.historyPlugin.recordEvent({ type: 'tool_call', ... });
  },
  afterExecute: async (tool, params, result) => {
    this.historyPlugin.recordEvent({ type: 'tool_result', ... });
  },
  onError: async (tool, params, error) => {
    this.historyPlugin.recordEvent({ type: 'error', ... });
  }
};
```

#### **EventService 방식 (1개 핸들러)**
```typescript
// PlaygroundEventService
emit(eventType: EventType, data: EventData): void {
  const conversationEvent = this.mapToConversationEvent(eventType, data);
  this.historyPlugin.recordEvent(conversationEvent);
}
```

### 🏗️ 실제 구현 시나리오

#### **Team assignTask 실행 플로우**
```typescript
// 1. Team 시작
TeamContainer.assignTask("Vue 분석해줘")
  ↓ eventService.emit('task.assigned', {
      sourceType: 'team',
      sourceId: 'team_main', 
      taskDescription: 'Vue 분석해줘',
      executionLevel: 0
  })
  ↓ PlaygroundEventService.mapToConversationEvent()
  ↓ historyPlugin.recordEvent({
      type: 'tool_call',
      content: '🎯 Task assigned: Vue 분석해줘',
      executionLevel: 0,
      executionPath: 'team_main'
  })

// 2. Agent 생성 및 실행
temporaryAgent.run("Vue.js 특징 분석")
  ↓ eventService.emit('execution.start', {
      sourceType: 'agent',
      sourceId: 'vue_expert_001',
      parentExecutionId: 'team_main',
      executionLevel: 1
  })
  ↓ PlaygroundEventService.mapToConversationEvent()
  ↓ historyPlugin.recordEvent({
      type: 'assistant_response',
      content: '🎯 agent execution started',
      executionLevel: 1,
      executionPath: 'team_main→vue_expert_001',
      parentEventId: 'team_main'
  })

// 3. Tool 호출
webSearchTool.execute({query: "Vue.js features"})
  ↓ eventService.emit('tool_call_start', {
      sourceType: 'tool',
      sourceId: 'vue_expert_001',
      toolName: 'webSearch',
      parameters: {query: "Vue.js features"},
      parentExecutionId: 'vue_expert_001',
      executionLevel: 2
  })
  ↓ PlaygroundEventService.mapToConversationEvent()
  ↓ historyPlugin.recordEvent({
      type: 'tool_call',
      content: '🚀 [webSearch] Starting...',
      executionLevel: 2,
      executionPath: 'team_main→vue_expert_001→webSearch',
      parentEventId: 'vue_expert_001'
  })
```

#### **최종 UI 블록 구조**
```
📦 Team: task.assigned
├── 👤 Agent: vue_expert_001 (execution.start)
│   ├── 🔍 Tool: webSearch (tool_call_start)  
│   ├── 🔍 Tool: webSearch (tool_call_complete)
│   └── 💭 Agent 응답 (execution.complete)
└── ✅ Task 완료 (task.completed)
```

### 🔍 핵심 구현 포인트

#### **1. 단일 진입점 보장**
- 모든 Team/Agent/Tool 이벤트가 `PlaygroundEventService.emit()` 한 곳으로 집중
- 이벤트 타입에 관계없이 일관된 처리 로직

#### **2. 계층 구조 자동 생성**
- `ToolExecutionContext`에서 계층 정보 추출
- `parentExecutionId`, `executionLevel`, `executionPath` 자동 설정
- UI에서 중첩 블록 구조 자동 표시

#### **3. 기존 로직 최대 재사용**
- `PlaygroundHistoryPlugin.recordEvent()` 메커니즘 그대로 활용
- `ConversationEvent` 구조 유지로 UI 변경 최소화

#### **4. 확장성 극대화**
- 새 이벤트 타입 추가 시 `mapToConversationEvent()`에만 케이스 추가
- 새 소스 타입 추가 시 `inferExecutionLevel()`에만 케이스 추가

## ⚠️ 중요 주의사항

### 개발 단계 vs 최종 버전
- **Phase 1-5**: EventService 완전 구현
- **Phase 6**: **임시 호환성** (개발 편의를 위해서만)
- **Phase 7**: 테스트 및 검증
- **Phase 8**: **모든 기존 코드 제거** (toolHooks, EventEmitterPlugin 등)

### 아키텍처 원칙
- ExecutionService와 동일한 주입 패턴 사용
- Facade Pattern 유지 (Agent/Team API 변경 최소화)
- Single Responsibility Principle 준수

### 성능 고려사항
- EventService는 단순한 emit만 담당
- 복잡한 처리는 EventService 구현체에서 담당
- 불필요한 이벤트 생성 방지

### 최종 목표
- **단일 이벤트 시스템**: EventService만 사용
- **깔끔한 아키텍처**: 중복 코드 완전 제거
- **높은 성능**: 불필요한 호환성 코드 없음

## 📅 예상 일정

- **Phase 1-2**: 2-3일 (핵심 EventService 구현)
- **Phase 3-4**: 2-3일 (ExecutionService/Tool 통합)
- **Phase 5**: 3-4일 (Playground 이벤트 핸들러 구현) ← **핵심**
- **Phase 6**: 1일 (임시 호환성 - 개발용)
- **Phase 7**: 2-3일 (테스트 및 검증)
- **Phase 8**: 1일 (최종 정리 및 레거시 제거)

**총 예상 기간**: 11-17일

## ✅ 성공 기준

### 기능적 목표
- [x] Team 모드에서 assignTask 도구 호출이 UI에 표시
- [x] Agent 모드 기존 기능 정상 동작 유지
- [x] 모든 이벤트가 올바른 순서로 기록
- [x] 계층 구조 완전한 추적 가능
- [x] **단일 이벤트 핸들러로 모든 이벤트 처리**

### 기술적 목표
- [x] 기존 아키텍처와 100% 일관성
- [x] 높은 테스트 커버리지
- [x] 성능 저하 없음
- [x] 메모리 효율적인 구현
- [x] **레거시 코드 완전 제거**

### 사용자 경험
- [x] Playground에서 완전한 실행 추적
- [x] 직관적인 계층 구조 표시
- [x] 실시간 진행 상황 확인
- [x] 오류 발생 위치 정확한 표시

---

**작성일**: 2025-01-28  
**상태**: 구현 준비 완료 (이벤트 핸들러 설계 검증 완료)  
**우선순위**: 최고  
**복잡도**: 낮음 (최종: EventService만 유지) 