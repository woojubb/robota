# EventService Implementation Tasks

## 개요
Robota SDK에서 Team/Agent/Tool의 통합 이벤트 시스템 구현 계획입니다. 
기존의 복잡한 eventHook 전파 방식을 대체하여 깔끔한 EventService 기반 아키텍처로 전환합니다.

---

## Phase 1: EventService 핵심 구현

### 1-1. EventService 인터페이스 정의
- [x] `packages/agents/src/services/event-service.ts` 생성
  - EventService 인터페이스 정의 (`emit(eventType, data)`)
  - SilentEventService, DefaultEventService, StructuredEventService 구현

### 1-2. Event 타입 정의
- [x] `packages/agents/src/services/event-service.ts` 타입 정의
  - ServiceEventType, ServiceEventData 인터페이스 정의
  - 표준 이벤트 타입 목록 정의 (execution.*, tool_call_*, task.*)

### 1-3. EventServiceHookFactory 구현
- [x] `packages/agents/src/utils/event-service-hook-factory.ts` 생성
  - createToolHooks(), createAgentToolHooks(), createTeamToolHooks() 정적 메소드 구현
  - ToolExecutionContext 기반 계층적 추적 지원

### 1-4. Export 설정
- [x] `packages/agents/src/index.ts` EventService 관련 export 추가

---

## Phase 2: Agent/Team EventService 통합

### 2-1. AgentConfig EventService 지원
- [x] `packages/agents/src/interfaces/agent.ts` 수정
  - AgentConfig에 eventService?: EventService 필드 추가

### 2-2. Robota Agent EventService 통합
- [x] `packages/agents/src/agents/robota.ts` 수정
  - EventService 의존성 주입
  - constructor에서 eventService 초기화 (SilentEventService 기본값)
  - ⚠️ **안티패턴**: run 메서드에 직접 이벤트 발생 코드 삽입됨 (제거 필요)

### 2-3. TeamContainerOptions EventService 지원
- [x] `packages/team/src/types.ts` 수정
  - TeamContainerOptions, TeamOptions에 eventService?: EventService 추가

### 2-4. TeamContainer EventService 통합
- [x] `packages/team/src/team-container.ts` 수정
  - EventService 의존성 주입
  - teamAgent 및 임시 Agent 생성 시 EventService 전달
  - ⚠️ **안티패턴**: assignTask 메서드에 직접 이벤트 발생 코드 삽입됨 (제거 필요)

### 2-5. createTeam 함수 EventService 지원
- [x] `packages/team/src/create-team.ts` 수정
  - TeamOptions에서 TeamContainerOptions로 eventService 전달

---

## Phase 3: ExecutionService EventService 통합

### 3-1. ExecutionService EventService 지원
- [x] `packages/agents/src/services/execution-service.ts` 수정
  - EventService 의존성 주입 (optional parameter)
  - SilentEventService 기본값 설정
  - ⚠️ **안티패턴**: execute 메서드에 직접 이벤트 발생 코드 삽입됨 (제거 필요)

### 3-2. ToolExecutionService EventService 전파
- [x] `packages/agents/src/services/tool-execution-service.ts` 수정
  - EventService 의존성 주입
  - ExecutionService에서 ToolExecutionService 생성 시 EventService 전달
  - ⚠️ **안티패턴**: executeTool 메서드에 직접 이벤트 발생 코드 삽입됨 (제거 필요)

---

## Phase 4: Tool EventService 지원

### 4-1. BaseTool EventService 지원
- [x] `packages/agents/src/abstracts/base-tool.ts` 수정
  - BaseToolOptions에 eventService?: EventService 추가
  - EventService 제공 시 자동으로 EventServiceHookFactory를 통해 hooks 생성

### 4-2. AgentDelegationTool EventService 전파
- [x] `packages/team/src/tools/agent-delegation-tool.ts` 수정
  - AgentDelegationToolOptions에 eventService?: EventService 추가
  - (타입 오류는 별도 해결 필요)

---

## Phase 5: Playground EventService 통합 (핵심 이벤트 핸들러) ✅

### 5-1. PlaygroundEventService 구현
- [x] `apps/web/src/lib/playground/playground-event-service.ts` 생성
  - EventService 인터페이스 구현
  - ServiceEventType을 ConversationEvent 형식으로 매핑
  - 계층적 추적 정보 (executionLevel, executionPath) 자동 생성

### 5-2. PlaygroundExecutor EventService 통합
- [x] `apps/web/src/lib/playground/robota-executor.ts` 수정
  - PlaygroundEventService 통합 완료 (historyPlugin과 연결)
  - Agent 생성 시 EventService 주입 완료
  - Team 생성 시 EventService 주입 완료
  - ServiceEventType을 BasicEventType으로 매핑 구현

### 5-3. PlaygroundHistoryPlugin EventService 연동
- [x] 기존 PlaygroundHistoryPlugin과 EventService 연결 완료
  - PlaygroundEventService가 ConversationEvent 형식으로 자동 변환
  - ServiceEventData를 PlaygroundHistoryPlugin 호환 형식으로 매핑
  - 계층적 추적 정보 (executionLevel, executionPath) 자동 생성

---

## Phase 6: 🚨 안티패턴 제거 (중요) ❌ **재작업 필요**

### 🚨 **핵심 문제 발견**: EventService 이벤트가 전혀 발생하지 않음

**근본 원인 분석**:
1. **메서드 래핑 실패**: `Robota.run()` 메서드를 constructor에서 교체했으나 실제로는 원본 클래스 메서드가 호출됨
2. **실행 플로우 불일치**: 실제 작업은 `ExecutionService.execute()`에서 수행되어 래핑된 `run` 메서드를 완전히 우회함
3. **ToolHooks 미연결**: ToolExecutionService에서 ToolHooks.onStart/onComplete가 호출되지 않음

**올바른 해결 방안**:
- constructor 메서드 래핑 제거
- ExecutionService와 ToolExecutionService 내부에서 직접 EventService.emit() 호출
- ToolHooks를 실제로 Tool 실행 시 호출하도록 수정

### 6-1. ExecutionService 내부 이벤트 발생 (재구현 필요)
- [ ] `packages/agents/src/services/execution-service.ts` 수정
  - execute() 메서드 시작/완료/에러 시 직접 EventService.emit() 호출
  - execution.start, execution.complete, execution.error 이벤트 발생

- [ ] `packages/agents/src/services/tool-execution-service.ts` 수정  
  - executeTool() 메서드에서 tool_call_start, tool_call_complete, tool_call_error 이벤트 발생
  - ToolHooks도 동시에 호출하여 기존 시스템과 호환

- [ ] `packages/agents/src/agents/robota.ts` 수정
  - constructor에서 메서드 래핑 코드 완전 제거
  - EventService는 ExecutionService에만 전달

### 6-2. ToolHooks 시스템 활성화 (미완성)
- [ ] `packages/agents/src/abstracts/base-tool.ts` 수정
  - EventService가 주입되면 EventServiceHookFactory로 ToolHooks 자동 생성하도록 수정
  - 현재 생성되고 있으나 실제로 호출되지 않는 문제 해결

- [ ] `packages/agents/src/services/tool-execution-service.ts` 수정
  - Tool 실행 시 hooks.onStart(), hooks.onComplete(), hooks.onError() 실제 호출
  - 현재 ToolHooks가 있어도 호출되지 않는 문제 해결

### 6-3. Team assignTask 이벤트 발생
- [ ] `packages/team/src/team-container.ts` 수정
  - assignTask() 시작/완료 시 task.assigned, task.completed 이벤트 발생
  - 비즈니스 로직과 분리하여 이벤트 발생

---

## Phase 7: 테스트 및 검증

### 7-1. ExecutionProxy 실제 적용
- [x] `packages/agents/src/agents/robota.ts`에 ExecutionProxy 적용
  - Agent 생성 후 자동으로 ExecutionProxy로 래핑
  - SilentEventService가 아닌 경우에만 적용
  - createExecutionProxy로 run/runStream 메서드 자동 이벤트 발생
- [x] ExecutionProxy 타입 에러 수정 완료 (ExecutionProxy<T extends object = object> 제네릭 기본값 추가)
- [x] 통합 테스트 예제 생성 (`apps/examples/19-eventservice-test.ts`)

### 7-2. 통합 테스트
- [x] EventService 통합 테스트 예제 작성
  - TestEventService 클래스로 이벤트 캡처 및 분석
  - Agent.run() 실행 시 execution.start/complete 이벤트 검증
  - 이벤트 메타데이터 및 계층적 정보 확인
- [ ] 실제 테스트 실행 및 검증 (import 에러로 보류)
- [ ] Team 통합 테스트 추가

### 7-3. 성능 테스트
- [ ] 이벤트 발생이 실행 성능에 미치는 영향 측정
- [ ] SilentEventService vs DefaultEventService 성능 비교

---

## Phase 8: 최종 정리 및 레거시 제거

### 8-1. 기존 코드 완전 제거
- [ ] 기존 eventHook 관련 코드 제거
- [ ] 임시 호환성 코드 제거

### 8-2. API 문서 업데이트
- [ ] EventService 사용법 문서화
- [ ] PlaygroundEventService 통합 가이드 작성

### 8-3. 코드 정리 및 최적화
- [ ] 불필요한 타입 정의 정리
- [ ] Import 경로 최적화

---

## 🎯 핵심 아키텍처 원칙

1. **비즈니스 로직 순수성**: 이벤트 발생 코드가 비즈니스 로직을 오염시키지 않음
2. **자동화**: ToolHooks, Proxy, Decorator를 통한 투명한 이벤트 발생
3. **계층적 추적**: parentExecutionId, executionLevel을 통한 완전한 실행 추적
4. **성능 최적화**: SilentEventService를 통한 zero-overhead 기본값
5. **단일 이벤트 핸들러**: PlaygroundEventService가 모든 이벤트를 받아 UI 블록 생성

## 📋 현재 상태

- ✅ **Phase 1-6 완료**: EventService 핵심 인프라 구축 & 안티패턴 제거
- ✅ **Phase 5 완료**: Playground EventService 통합 (PlaygroundEventService, PlaygroundExecutor)
- 🔄 **Phase 7 진행 중**: ExecutionProxy 적용 & 테스트 (90% 완료)
- ✅ **빌드 성공**: ExecutionProxy 타입 에러 해결 완료, 전체 패키지 빌드 성공
- 📋 **다음 단계**: 타입 에러 수정 & 실제 테스트 실행

---

## 🚨 즉시 수정이 필요한 안티패턴

1. **Robota.run()**: `this.eventService.emit('execution.start', ...)` 제거 필요
2. **TeamContainer.assignTask()**: `this.eventService.emit('task.assigned', ...)` 제거 필요
3. **ExecutionService.execute()**: `this.eventService.emit('execution.start', ...)` 제거 필요
4. **ToolExecutionService.executeTool()**: `this.eventService.emit('tool_call_start', ...)` 제거 필요

이러한 직접 호출들은 모두 ToolHooks나 Proxy 패턴을 통해 자동화되어야 합니다. 