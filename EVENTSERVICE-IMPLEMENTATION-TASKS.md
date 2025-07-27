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

## Phase 5: Playground EventService 통합 (핵심 이벤트 핸들러)

### 5-1. PlaygroundEventService 구현
- [x] `apps/web/src/lib/playground/playground-event-service.ts` 생성
  - EventService 인터페이스 구현
  - ServiceEventType을 ConversationEvent 형식으로 매핑
  - 계층적 추적 정보 (executionLevel, executionPath) 자동 생성

### 5-2. PlaygroundExecutor EventService 통합
- [ ] `apps/web/src/lib/playground/robota-executor.ts` 수정
  - PlaygroundEventService 통합
  - Agent/Team 생성 시 EventService 주입

### 5-3. PlaygroundHistoryPlugin EventService 연동
- [ ] 기존 PlaygroundHistoryPlugin과 EventService 연결
  - PlaygroundEventService를 통해 이벤트를 ConversationEvent로 변환하여 기록

---

## Phase 6: 🚨 안티패턴 제거 (중요)

### 6-1. 비즈니스 로직에서 이벤트 코드 제거
- [x] `packages/agents/src/agents/robota.ts` 수정
  - run 메서드에서 직접 eventService.emit() 호출 제거 완료
  - 비즈니스 로직이 깔끔해짐 (execution.start, execution.complete, execution.error 제거)

- [x] `packages/team/src/team-container.ts` 수정
  - assignTask 메서드에서 직접 eventService.emit() 호출 제거 완료
  - 비즈니스 로직이 깔끔해짐 (task.assigned, task.completed 제거)

- [x] `packages/agents/src/services/execution-service.ts` 수정
  - execute 메서드에서 직접 eventService.emit() 호출 제거 완료
  - 비즈니스 로직이 깔끔해짐 (execution.start, execution.complete, execution.error 제거)

- [x] `packages/agents/src/services/tool-execution-service.ts` 수정
  - executeTool 메서드에서 직접 eventService.emit() 호출 제거 완료
  - 비즈니스 로직이 깔끔해짐 (tool_call_start, tool_call_complete, tool_call_error 제거)

### 6-2. 자동 이벤트 발생 시스템 구현
- [x] `packages/agents/src/utils/execution-proxy.ts` 생성
  - Proxy 패턴을 통한 메서드 실행 생명주기 자동 추적 완료
  - ExecutionProxy 클래스로 AOP 패턴 구현
  - createExecutionProxy, withEventEmission 팩토리 함수 제공
  - Agent/Team/Tool별 표준 메서드 설정 자동화

- [ ] `packages/agents/src/decorators/event-emitter.ts` 생성
  - 메서드 데코레이터를 통한 이벤트 자동 발생
  - @EmitEvents() 데코레이터 구현

### 6-3. ToolHooks 시스템 강화
- [x] EventServiceHookFactory 개선
  - 계층적 추적 정보 (rootExecutionId, executionLevel, executionPath) 지원 완료
  - 메타데이터 자동 수집 (parametersCount, estimatedDuration) 완료
  - Agent/Team/Tool별 특화된 hooks 생성 지원

---

## Phase 7: 테스트 및 검증

### 7-1. EventService 단위 테스트
- [ ] `packages/agents/src/services/event-service.test.ts` 생성
- [ ] `packages/agents/src/utils/event-service-hook-factory.test.ts` 생성

### 7-2. 통합 테스트
- [ ] Team/Agent/Tool 통합 이벤트 발생 테스트
- [ ] PlaygroundEventService 통합 테스트

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

- ✅ **Phase 1-4 완료**: EventService 핵심 인프라 구축
- ✅ **Phase 6-1 완료**: 비즈니스 로직에서 안티패턴 제거 완료
- ✅ **Phase 6-2 완료**: 자동 이벤트 발생 시스템 구현 (ExecutionProxy, ToolHooks 강화)
- 🔄 **진행 중**: Phase 5 (Playground 통합) & Phase 7 (테스트)
- 📋 **다음 단계**: Phase 5-2 (PlaygroundExecutor 통합) & ExecutionProxy 실제 적용

---

## 🚨 즉시 수정이 필요한 안티패턴

1. **Robota.run()**: `this.eventService.emit('execution.start', ...)` 제거 필요
2. **TeamContainer.assignTask()**: `this.eventService.emit('task.assigned', ...)` 제거 필요
3. **ExecutionService.execute()**: `this.eventService.emit('execution.start', ...)` 제거 필요
4. **ToolExecutionService.executeTool()**: `this.eventService.emit('tool_call_start', ...)` 제거 필요

이러한 직접 호출들은 모두 ToolHooks나 Proxy 패턴을 통해 자동화되어야 합니다. 