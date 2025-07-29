# Robota SDK Tree 구조 완성 작업 목록

## 🎯 목표

`apps/examples/23-hierarchy-verification-test.ts` 실행 시 **✅ HIERARCHY VERIFICATION PASSED** 출력 달성

---

## 🔍 **Phase 1: 현재 문제 정확한 진단 (최우선 - 모든 작업의 기반)**

### **1.1 테스트 실행 및 출력 분석 (가장 먼저)**
- [ ] `cd apps/examples && npx tsx 23-hierarchy-verification-test.ts` 실행
- [ ] `Level: undefined, Parent: undefined` 이벤트들의 `sourceType`, `sourceId`, `eventType` 모두 기록
- [ ] `Enhanced EventService Hierarchy Debug` 섹션의 등록된 노드 ID와 metadata 기록
- [ ] 실제 이벤트 executionId vs 등록된 hierarchy key 불일치 케이스 식별
- [ ] 성공/실패 이벤트의 데이터 구조 차이점 비교

### **1.2 상세 로깅 추가 (모든 디버깅의 기반 - 높은 우선순위)**
- [ ] `ActionTrackingEventService.findExecutionId`에 상세 로깅 추가:
  - [ ] 시도하는 모든 ID 값들 출력
  - [ ] hierarchy에 등록된 모든 key와 비교 결과 출력
  - [ ] 매칭 성공/실패 이유 출력
- [ ] `ToolExecutionService.executeTool` 호출 여부 로깅:
  - [ ] 메서드 진입 시점 로깅
  - [ ] Duck Typing 감지 성공/실패 로깅  
  - [ ] `trackExecution` 호출 및 등록 로깅
- [ ] `enrichWithHierarchy` 호출 횟수와 성공률 측정

### **1.3 실행 경로 추적 (로깅 후 진행)**
- [ ] `AgentDelegationTool.execute()` 실행 경로 추적:
  - [ ] `ToolExecutionService.executeTool` 우회 여부 확인
  - [ ] `BaseTool.execute()` 직접 호출 경로 확인
- [ ] Remote vs Local executor 실행 경로 차이점 비교
- [ ] `tool-G`, `agent-XXX` 등 sourceId 생성 위치 추적

---

## ⚡ **Phase 2: 핵심 차단 문제 해결 (선행 필수)**

### **2.1 ToolExecutionService 우회 문제 해결 (최고 우선순위)**
> **이유**: 이 문제가 해결되지 않으면 Duck Typing이 작동하지 않아 다른 모든 작업이 무의미함

- [ ] Browser 환경에서 `ToolExecutionService.executeTool` 우회 문제 진단:
  - [ ] `AgentDelegationTool.execute()`에서 ToolExecutionService 호출 여부 확인
  - [ ] Remote Executor 사용 시 실행 경로 추적
- [ ] 우회 문제 해결 방안 적용:
  - [ ] `AgentDelegationTool.execute()`에서 ToolExecutionService 우회 방지
  - [ ] 또는 BaseTool에서 Duck Typing 수행하도록 수정
- [ ] Remote/Local 환경에서 동일한 hierarchy tracking 보장

### **2.2 executionId 누락 문제 해결 (두 번째 우선순위)**
> **이유**: executionId가 없으면 매핑 자체가 불가능하므로 선행 필수

- [ ] `EventServiceHookFactory.createToolHooks` 수정:
  - [ ] `context.executionId`가 undefined인 경우 원인 파악
  - [ ] undefined면 에러 또는 새 ID 생성
  - [ ] 모든 이벤트 데이터에 `executionId` 필드 명시적 추가
- [ ] `AgentDelegationTool.executeWithHooks` 검증:
  - [ ] `enhancedContext.executionId` 설정 확인
  - [ ] context 전달 체인에서 executionId 손실 방지
- [ ] `ToolExecutionService.executeTool`에서 생성한 executionId가 toolContext에 정확히 설정되는지 확인

---

## 🔧 **Phase 3: ExecutionId 매핑 개선 (기반 작업 완료 후)**

### **3.1 findExecutionId 로직 개선**
- [ ] `ActionTrackingEventService.findExecutionId` 알고리즘 수정:
  1. `data.executionId` 정확한 매칭
  2. `data.metadata.executionId` 매칭
  3. `data.metadata.toolCallId` 매칭
  4. `data.context?.executionId` 매칭
  5. sourceId 패턴 매칭 (`tool-G` → `call_XXX` 변환)
  6. 매칭 실패 시 fallback 처리
- [ ] 각 단계별 성공률 측정 및 로깅
- [ ] sourceId → executionId 매핑 테이블 구현

### **3.2 ID 생성 및 전달 체인 정리**
- [ ] BaseTool에서 자체 ID 생성 시 context.executionId 우선 사용하도록 수정
- [ ] context.executionId가 undefined인 경우 명확한 에러 로깅
- [ ] 모든 `emit` 호출에서 executionId 필드 검증

---

## 🎯 **Phase 4: 계층 구조 정확성 보장**

### **4.1 Level 분류 정확성**
- [ ] 이벤트 타입별 Level 자동 분류:
  - [ ] `execution.*` → Level 0
  - [ ] `tool_call.*` → Level 1  
  - [ ] `team.*`, `agent.*` → Level 2
- [ ] `ActionTrackingEventService.trackExecution`에서 level 정보 정확히 설정
- [ ] Level이 undefined인 이벤트 후처리로 자동 수정

### **4.2 Parent-Child 관계 설정**
- [ ] Level 1 이벤트가 Level 0 conversation을 부모로 참조하도록 수정
- [ ] Level 2 이벤트가 해당 Level 1 tool_call을 부모로 참조하도록 수정
- [ ] `parentExecutionId` 필드가 모든 이벤트에 포함되도록 보장
- [ ] 시간순 최근 상위 Level 이벤트를 parent로 자동 설정하는 로직 구현

### **4.3 ExecutionPath 및 Root ID 설정**
- [ ] parent 체인을 역추적하여 `executionPath` 배열 생성
- [ ] 최상위 노드를 `rootExecutionId`로 설정
- [ ] 모든 하위 이벤트에 동일한 rootExecutionId 전파

---

## 🔍 **Phase 5: 환경별 대응 (선택적)**

### **5.1 환경별 호환성 확인**
- [ ] Local/Remote 환경에서 동일한 이벤트 수와 계층 구조 생성 확인
- [ ] 환경별 차이점 제거 및 일관된 동작 보장
- [ ] Fallback 메커니즘 구현
- [ ] Enhanced EventService 직접 활용 로직 추가

---

## ✅ **검증 및 완성**

### **중간 검증 (각 Phase 완료 후 실행)**
- [ ] Phase 2 완료 후: `23-hierarchy-verification-test.ts` 실행하여 ToolExecutionService 호출 여부 확인
- [ ] Phase 3 완료 후: executionId 매핑 성공률 확인
- [ ] Phase 4 완료 후: Level 및 Parent-Child 관계 정확성 확인

### **최종 테스트 통과 확인**
- [ ] `23-hierarchy-verification-test.ts` 실행하여 ✅ SUCCESS 확인
- [ ] 총 이벤트 수 20개 이상 달성
- [ ] 3단계 계층 구조 (Level 0, 1, 2) 완전 구현
- [ ] 모든 이벤트에 정확한 parentExecutionId 포함
- [ ] `Level: undefined, Parent: undefined` 완전 제거
- [ ] hierarchy debug에서 등록된 노드와 이벤트 일치

### **다양한 시나리오 테스트**
- [ ] 단순한 Team 실행 테스트
- [ ] 복잡한 Team 실행 테스트
- [ ] 에러 발생 시나리오 테스트
- [ ] Local/Remote 환경 모두 테스트

---

## 📋 **성공 기준**

1. **23-hierarchy-verification-test.ts에서 ✅ HIERARCHY VERIFICATION PASSED 출력**
2. **모든 이벤트에 정확한 Level (0, 1, 2) 분류**
3. **모든 이벤트에 올바른 parentExecutionId 포함**
4. **등록된 hierarchy 노드와 이벤트 executionId 완전 일치**
5. **Robota SDK 아키텍처 원칙 및 rule 100% 준수**
6. **Zero Breaking Change 유지**

---

## 🚀 **최적화된 작업 순서**

### **1단계: 즉시 실행 (당일)**
1. **Phase 1.1**: 테스트 실행 및 출력 분석
2. **Phase 1.2**: 상세 로깅 추가 (모든 디버깅의 기반)

### **2단계: 핵심 차단 문제 해결 (1-2일)**  
3. **Phase 2.1**: ToolExecutionService 우회 문제 해결 (최고 우선순위)
4. **Phase 2.2**: executionId 누락 문제 해결 (두 번째 우선순위)
5. **중간 검증**: ToolExecutionService 호출 및 executionId 설정 확인

### **3단계: 매핑 및 구조 완성 (1-2일)**
6. **Phase 3**: ExecutionId 매핑 개선
7. **Phase 4**: 계층 구조 정확성 보장
8. **중간 검증**: 매핑 성공률 및 계층 구조 확인

### **4단계: 최종 검증 (1일)**
9. **Phase 5**: 환경별 대응 (필요시)
10. **최종 검증**: 모든 테스트 통과 확인

**🎯 핵심 전략: 선행 작업(로깅, ToolExecutionService 우회 해결)을 먼저 완료하여 나머지 작업의 성공 확률을 극대화** 