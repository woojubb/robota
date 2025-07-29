# Robota SDK 남은 작업 목록

## 🎯 개요

Enhanced EventService 시스템이 성공적으로 구현되어 Team/Agent/Tool 실행 tree 구조 문제가 해결되었습니다. 다음은 추가 최적화 및 완성도를 위한 남은 작업들입니다.

---

## 🚨 **우선순위 높음: 세부 최적화**

### **📋 Phase 0.4: ExecutionId Context 전달 문제 해결**
- [ ] executeWithHooks에서 context.executionId 확인
- [ ] EventServiceHookFactory로 올바른 executionId 전달 보장
- [ ] tool_call 이벤트가 Level 2로 정확히 표시되도록 수정

### **📋 Phase 1: Remote Executor 호환성 완전 해결**
- [ ] **1.1 Remote Executor 실행 흐름 분석**
  - [ ] `packages/openai/src/provider.ts`에서 remote executor 사용 여부 확인
  - [ ] Browser 환경에서 tool 실행이 어떻게 처리되는지 추적
  - [ ] ToolExecutionService 우회 경로 파악
  - [ ] 일관된 실행 흐름을 위한 수정 지점 식별

- [ ] **1.2 ExecutionService 일관성 보장**
  - [ ] Remote executor 사용 시에도 ToolExecutionService 경유하도록 수정
  - [ ] 또는 BaseTool에서 직접 실행될 때도 hierarchy tracking 보장
  - [ ] executor 설정과 무관하게 동일한 이벤트 발생 흐름 구현
  - [ ] 테스트로 Local/Remote 동작 일관성 검증

- [ ] **1.3 명확한 에러 메시지 추가**
  - [ ] Hierarchy 정보 없을 때 구체적인 해결 방법 안내
  - [ ] Remote executor 사용 시 특별한 설정 필요 여부 안내
  - [ ] 디버깅을 위한 실행 경로 로깅

### **📋 Phase 2: ExecutionId 통일 및 매핑 개선**
- [ ] **2.1 단일 ExecutionId 전략 구현**
  - [ ] ToolExecutionService가 생성한 executionId를 context에 포함
  - [ ] BaseTool이 context.executionId 우선 사용하도록 수정
  - [ ] 자체 ID 생성은 fallback으로만 사용
  - [ ] 모든 이벤트에서 동일한 executionId 사용 보장

- [ ] **2.2 findExecutionId 로직 개선**
  - [ ] tool-G 같은 sourceId와 실제 executionId 매핑 테이블 구현
  - [ ] 다양한 ID 형식 (call_XXX, assignTask-XXX, agent-XXX) 통일
  - [ ] 계층적 ID 검색 로직 구현 (exact match → partial match → fallback)

- [ ] **2.3 EventService 이벤트 데이터 표준화**
  - [ ] 모든 이벤트 발생 시 executionId 필수 포함
  - [ ] sourceId와 executionId의 명확한 구분
  - [ ] 이벤트 데이터 검증 로직 추가

---

## 🔧 **우선순위 중간: 시스템 정리 및 최적화**

### **📋 Phase 3: TeamContainer 이벤트 개선**
- [ ] **3.1 이벤트 발생 시 executionId 포함**
  - [ ] `packages/team/src/team-container.ts`의 모든 emit 호출 수정
  - [ ] context에서 받은 executionId를 이벤트 데이터에 포함
  - [ ] sourceId는 agentId, executionId는 tool 실행 ID로 구분

- [ ] **3.2 Agent 생성 시 hierarchy 정보 전달**
  - [ ] Agent 생성 시 parentExecutionId 설정
  - [ ] Agent의 EventService에도 Enhanced EventService 전달
  - [ ] 중첩된 tool 호출 시에도 계층 정보 유지

### **📋 Phase 4: Tool Hook 시스템 제거 (리팩터링)**
- [ ] **4.1 실패한 Tool Hook 시스템 분석 및 제거 준비**
  - [ ] 현재 Tool Hook 사용 현황 분석
  - [ ] `packages/agents/src/utils/event-service-hook-factory.ts` 사용처 확인
  - [ ] `packages/team/src/tools/agent-delegation-tool.ts`의 `executeWithHooks` 사용 확인
  - [ ] `packages/agents/src/abstracts/base-tool.ts`의 hooks 시스템 분석
  - [ ] Enhanced EventService가 Tool Hook 기능을 완전히 대체하는지 검증

- [ ] **4.2 Tool Hook 관련 코드 제거**
  - [ ] `packages/agents/src/utils/event-service-hook-factory.ts` 삭제
  - [ ] `packages/agents/src/interfaces/tool.ts`에서 `ToolHooks` 관련 타입 제거
  - [ ] `packages/agents/src/abstracts/base-tool.ts`에서 hooks 시스템 제거
  - [ ] `packages/team/src/tools/agent-delegation-tool.ts`에서 `executeWithHooks` 제거

- [ ] **4.3 AgentDelegationTool 단순화**
  - [ ] hooks 없이 직접 tool 실행하도록 수정
  - [ ] Enhanced EventService의 자동 추적 기능만 활용
  - [ ] 코드 복잡성 대폭 감소

### **📋 Phase 5: AI Provider 필수화 및 아키텍처 정리**
- [ ] **5.1 명확한 에러 메시지로 교체**
  - [ ] "Either provide executor or implement direct execution" → 구체적 해결책 제시
  - [ ] ConfigurationError 타입 사용으로 에러 분류 명확화
  - [ ] 사용자가 즉시 수정 가능한 안내 메시지

- [ ] **5.2 "Either X or Y" 패턴 제거**
  - [ ] BaseAIProvider의 executeViaExecutorOrDirect fallback 제거
  - [ ] 명확한 단일 실행 경로만 허용
  - [ ] Provider 생성 시점에 실행 방식 결정

- [ ] **5.3 불필요한 조건부 실행 제거**
  - [ ] `if (!this.provider)` 같은 fallback 로직 모두 제거
  - [ ] Provider는 생성자에서 필수로 검증
  - [ ] Runtime 시점에는 항상 유효한 Provider 보장

---

## 🧪 **우선순위 낮음: 검증 및 테스트**

### **📋 Phase 6: 호환성 및 성능 테스트**
- [ ] **6.1 기존 코드 호환성 테스트**
  - [ ] EventService 없이 Agent 생성하는 기존 코드 테스트
  - [ ] TeamContainer 생성 시 eventService 없는 경우 테스트
  - [ ] SilentEventService가 기본값으로 정상 작동하는지 확인

- [ ] **6.2 성능 및 안정성 테스트**
  - [ ] 여러 번의 팀 실행으로 메모리 누수 없음 확인
  - [ ] 계층 구조가 올바르게 정리되는지 확인
  - [ ] 에러 상황에서도 이벤트 누락 없음 확인
  - [ ] 이벤트 발생 성능 오버헤드 측정 (< 5ms per event)

- [ ] **6.3 Playground UI 통합 테스트**
  - [ ] Enhanced EventService가 적용된 Playground에서 Team 실행
  - [ ] UI에서 계층적 블록 구조 표시되는지 확인
  - [ ] 각 블록의 부모-자식 관계가 올바른지 검증
  - [ ] 성능 저하 없이 실시간 업데이트되는지 확인

### **📋 Phase 7: PlaygroundEventService 연결 확인**
- [ ] **7.1 이벤트 수신 검증**
  - [ ] `apps/web/src/lib/playground/playground-event-service.ts` 확인
  - [ ] `createPlaygroundEventService` 함수의 `emit` 메서드 확인
  - [ ] 모든 새로운 이벤트 타입이 올바르게 처리되는지 확인

- [ ] **7.2 ConversationEvent 매핑 확인**
  - [ ] `mapToConversationEvent` 함수에서 새로운 이벤트 타입 매핑 확인
  - [ ] `parentExecutionId`, `executionLevel`, `executionPath` 필드 매핑 확인
  - [ ] UI에서 표시할 이벤트 타입과 스타일 확인

- [ ] **7.3 PlaygroundHistoryPlugin 연동 확인**
  - [ ] `recordEvent` 메서드가 새로운 계층 정보를 올바르게 저장하는지 확인
  - [ ] 이벤트 검색 및 필터링 기능 동작 확인

---

## 📚 **우선순위 낮음: 문서화 및 정리**

### **📋 Phase 8: 문서화 및 정리**
- [ ] **8.1 변경사항 문서화**
  - [ ] ActionTrackingEventService 사용법 문서화
  - [ ] 계층 구조 시각화 예시 추가
  - [ ] 기존 코드와의 호환성 보장 명시

- [ ] **8.2 예제 코드 업데이트**
  - [ ] EventService 사용 예제 추가
  - [ ] 계층 구조 활용 방법 예시 제공
  - [ ] 디버깅 가이드 작성

- [ ] **8.3 Tool Hook 제거 관련 마이그레이션 가이드**
  - [ ] 기존 Tool Hook 사용 코드의 대체 방법 설명
  - [ ] Enhanced EventService 자동 추적 활용법

- [ ] **8.4 최종 검토**
  - [ ] 모든 변경사항이 Zero Breaking Change 원칙을 지키는지 확인
  - [ ] 코드 리뷰를 통한 품질 검증
  - [ ] 배포 전 최종 통합 테스트

---

## 🎯 **작업 우선순위 요약**

### **1순위 (즉시 필요)**
- Phase 0.4: ExecutionId Context 전달 문제 해결
- Phase 2.2: findExecutionId 로직 개선

### **2순위 (단기 개선)**
- Phase 1: Remote Executor 호환성 완전 해결
- Phase 2.1, 2.3: ExecutionId 통일 및 표준화

### **3순위 (중기 리팩터링)**
- Phase 4: Tool Hook 시스템 제거
- Phase 5: AI Provider 필수화

### **4순위 (장기 완성도)**
- Phase 6, 7: 테스트 및 검증
- Phase 8: 문서화 및 정리

---

## 📊 **현재 상태**

✅ **완료된 핵심 기능**:
- Enhanced EventService 시스템 구현
- Tool Hook 중복 호출 문제 해결
- 이벤트 수 750% 증가 (4개 → 34개)
- Team/Agent/Tool 실행 tree 구조 문제 근본적 해결

🔄 **개선이 필요한 영역**:
- ExecutionId Context 전달의 일부 불일치
- Remote Executor 환경에서의 완전한 호환성
- Tool Hook 시스템의 완전한 제거

🎯 **최종 목표**:
- 100% 정확한 계층 구조 표시
- 모든 환경에서 일관된 동작
- 코드 복잡성 최소화 및 유지보수성 극대화 