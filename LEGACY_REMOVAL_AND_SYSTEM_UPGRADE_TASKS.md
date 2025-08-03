# Legacy Sub-System 완전 제거 및 Agent 번호 시스템 교체 작업 목록

## 📋 프로젝트 개요

**최종 목표**: Playground 테스트 데이터 수준의 완벽한 연결 구조 달성 (100% 연결 성공)

**현재 상황 분석**:
- **✅ Playground**: 13개 연결, 100% 성공 (이상적 구조)
- **❌ SDK 실행**: 다수 ❌ 연결, ~40% 성공률

**단계별 목표**:
1. **Phase 0 (사전작업)**: Agent Integration Instance 시스템 구현 → **85% 연결 달성**
2. **Phase 1 (연결수정)**: 와일드카드 제거 → **핵심 연결 문제 해결**  
3. **Phase 2 (통합완성)**: Response 통합 시스템 → **Playground 수준 달성**

**구체적 연결 실패들**:
1. **`thinking_conv_*_* → tool_call_undefined (executes)`** - 와일드카드 및 undefined ID 문제  
2. **`agent_0_agent-* → thinking_agent_0_* (processes)`** - Agent ID 불일치 문제
3. **`thinking_agent-*_* → tool_call_tool-* (executes)`** - Thinking→Tool Call 연결 누락
4. **`agent_task-aggregator → merge_results_undefined (result)`** - Sub 시스템 레거시 문제
5. **`response_* → agent_integration_instance (return)`** - Agent Integration Instance 시스템 부재
6. **`agent_integration_instance → final_thinking (processes)`** - 최종 통합 흐름 부재

**성공 조건**: 
- **100% 연결 성공**: Playground와 동일한 13개 완벽 연결
- **교차 연결 방지**: Agent Integration Instance 시스템으로 선형 흐름
- **도메인 중립성**: 모든 타입이 도메인 독립적

---

## 🏗️ Phase 0: Agent Integration Instance 시스템 구현 (Priority: Highest - 사전작업)

### 🎯 목표: Playground 수준 완벽 연결을 위한 사전 아키텍처 구축

**Agent Integration Instance 개념**:
- **기존 "Agent Copy"**: ❌ 복사 개념 제거
- **새로운 "Agent Integration Instance"**: ✅ 결과 통합 전용 인스턴스
- **역할**: 여러 Response를 받아 최종 통합 처리하는 별도 Agent 인스턴스

### 0.1 이벤트 시스템 확장

- [ ] **새로운 이벤트 타입 추가**: `packages/agents/src/services/event-service.ts`
  ```typescript
  | 'agent.integration_start'     // Agent Integration Instance 시작
  | 'agent.integration_complete'  // Agent Integration Instance 완료
  | 'response.integration'        // Response 통합 시작
  ```

- [ ] **ServiceEventData 확장**: 통합 관련 메타데이터 추가
  ```typescript
  /** Integration-specific data */
  integrationId?: string;
  sourceResponseIds?: string[];
  integrationLevel?: number;
  ```

### 0.2 WorkflowConnectionType 확장

- [ ] **새로운 연결 타입 추가**: `workflow-event-subscriber.ts`
  ```typescript
  | 'integrates'         // Response → Agent Integration Instance
  | 'consolidates'       // Agent Integration Instance → Final Thinking  
  | 'finalizes'          // Final Thinking → Output
  ```

### 0.3 Agent Integration Instance 노드 생성 로직

- [ ] **createAgentIntegrationInstance 메서드 구현**:
  ```typescript
  private createAgentIntegrationInstance(data: ServiceEventData): WorkflowNode {
    const integrationNodeId = `agent_integration_${data.integrationId}`;
    // 결과 통합 전용 Agent 인스턴스 생성
  }
  ```

- [ ] **handleResponseIntegration 메서드 구현**:
  ```typescript
  private handleResponseIntegration(data: ServiceEventData): void {
    // 여러 Response를 Agent Integration Instance로 연결
  }
  ```

### 0.4 통합 흐름 구현

- [ ] **Response → Integration Instance 연결 로직**
- [ ] **Integration Instance → Final Thinking 연결 로직**  
- [ ] **교차 연결 방지 메커니즘 구현**

---

## 🗑️ Phase 1: 레거시 완전 말살 (Priority: Critical)

### 🚫 와일드카드 연결 시스템 완전 제거 (근본 문제 해결)

**✅ 부분 성공 - 부분 경로 직접 매핑 시스템 구현 완료**:
- [x] **SubAgentEventRelay**: Team → Agent 위임에서 완벽한 직접 매핑
- [x] **ExecutionService**: 비/스트리밍 모드에서 직접 parentId 제공  
- [x] **WorkflowEventSubscriber**: 추론 로직 제거 및 직접 ID 사용
- [x] **직접 매핑 설계**: "추론 없는 직접 매핑" 시스템 확립

**❌ 미완성 부분 - Team Agent 초기 이벤트 경로 누락**:
- [ ] **Team Agent 초기 assignTask**: 직접 매핑 시스템 우회 중
- [ ] **와일드카드 지속**: `thinking_*_* → tool_call_undefined` 패턴 여전히 발생
- [ ] **완전성 부족**: 모든 실행 경로 커버 필요

**🎯 추가 완성 작업 필요**:
- [ ] **Team Agent 최상위 경로 조사**: `packages/team/src/team-container.ts` 실행 경로 분석
- [ ] **Robota 클래스 직접 매핑**: 최상위 Agent 실행에서 thinkingNodeId 직접 제공
- [ ] **Event 흐름 완전 추적**: Team Leader 초기 assignTask 이벤트 경로 매핑
- [ ] **전체 시스템 검증**: 모든 와일드카드 패턴 제거 확인

**🔍 상세 분석 작업**:
- [x] **Team.ts 이벤트 흐름**: Team Leader가 생성하는 첫 번째 assignTask 이벤트의 thinkingNodeId 제공 여부 확인 ✅
- [x] **Agent.ts 직접 매핑**: Agent 클래스 자체의 execute 메서드에서 직접 매핑 적용 확인 ✅  
- [x] **EventService 체인**: 모든 이벤트 체인에서 thinkingNodeId와 directParentId 전파 확인 ✅
- [x] **누락 경로 식별**: Team Agent (Agent 0) 초기 실행에서 직접 매핑이 적용되지 않는 구체적 위치 식별 ✅

**✅ 주요 개선 완료**:
- [x] **tool_call_undefined 해결**: createToolCallResponseNode에서 finalExecutionId 대체 로직 추가
- [x] **연결 누락 문제 해결**: RealTimeWorkflowBuilder에 node.connections 추출 로직 추가
- [x] **Playground 데이터 생성 오류 해결**: undefined length 오류 null-safe 접근으로 수정
- [x] **부분적 와일드카드 제거**: 일부 processes 연결이 ✅ 성공적으로 생성됨

**🎯 지속적 개선 중**:
- [ ] **완전한 연결 달성**: 현재 일부 연결은 성공하지만 일부는 여전히 실패
- [ ] **Agent ID 불일치 해결**: `agent_0_agent-*` 패턴 vs `agent_0_conv_*` 패턴 통일 필요

### 타입 시스템 레거시 제거

- [ ] **ServiceEventType 정리**: `packages/agents/src/services/event-service.ts`
  - [ ] `subtool.call_start` 타입 완전 삭제
  - [ ] `subtool.call_complete` 타입 완전 삭제
  - [ ] `subtool.call_error` 타입 완전 삭제
  - [ ] 관련 주석 및 문서 정리

- [ ] **SourceType 정리**: `packages/agents/src/services/event-service.ts`
  - [ ] `sourceType` union에서 `'sub-agent'` 완전 삭제
  - [ ] `sourceType: 'agent' | 'team' | 'tool'`로 단순화

- [ ] **WorkflowConnectionType 정리**: `packages/agents/src/services/workflow-event-subscriber.ts`
  - [ ] `'spawn'` 연결 타입 완전 삭제
  - [ ] `'delegate'` 연결 타입 완전 삭제
  - [ ] `'consolidate'` 연결 타입 완전 삭제
  - [ ] 관련 주석 업데이트

- [ ] **UniversalNodeTypes 정리**: `packages/agents/src/services/workflow-converter/universal-types.ts`
  - [ ] `SUB_AGENT: 'sub_agent'` 완전 삭제
  - [ ] `SUB_TOOL_CALL: 'sub_tool_call'` 완전 삭제
  - [ ] 관련 매핑 및 색상 정의 삭제

### 이벤트 처리 레거시 제거

- [ ] **Subtool 이벤트 케이스 삭제**: `packages/agents/src/services/workflow-event-subscriber.ts`
  - [ ] `case 'subtool.call_start':` 완전 삭제
  - [ ] `case 'subtool.call_complete':` 완전 삭제
  - [ ] 관련 핸들러 호출 제거

### 메서드 완전 삭제

- [ ] **createSubToolCallNode 메서드 삭제**: `packages/agents/src/services/workflow-event-subscriber.ts`
  - [ ] 메서드 전체 삭제 (Line 426-443)
  - [ ] 호출하는 코드 모두 제거

- [ ] **handleSubAgentNode 메서드 삭제**: `packages/agents/src/services/real-time-workflow-builder.ts`
  - [ ] 메서드 전체 삭제 (Line 287-302)
  - [ ] 관련 주석 삭제

- [ ] **createSpawnConnection 메서드 삭제**: `packages/agents/src/services/real-time-workflow-builder.ts`
  - [ ] 메서드 전체 삭제 (Line 318-334)
  - [ ] 호출하는 코드 모두 제거

### 조건문 및 ID 패턴 제거

- [ ] **Sub-Agent 조건문 제거**: `packages/agents/src/services/workflow-event-subscriber.ts`
  - [ ] Line 492: `data.sourceType === 'sub-agent'` 조건문 완전 제거
  - [ ] `sub_agent_${data.sourceId}` ID 패턴 제거
  - [ ] 통합된 Agent 번호 시스템으로 교체

- [ ] **updateNodeStatus 내 Sub ID 패턴 제거**: `packages/agents/src/services/workflow-event-subscriber.ts`
  - [ ] Line 567: `sub_agent_${nodeId}` 패턴 삭제
  - [ ] Line 569: `sub_tool_call_${nodeId}` 패턴 삭제

### 주석 및 문서 정리

- [ ] **주석에서 Sub 개념 완전 제거**
  - [ ] "Sub-Agent", "Sub-Response", "Sub-Tool" 용어 모두 삭제
  - [ ] Agent 번호 시스템 용어로 교체
  - [ ] 아키텍처 설명 업데이트

---

## 🆕 Phase 2: 새로운 시스템 구축 (Priority: High)

### Agent Copy 시스템 구현

- [ ] **AGENT_COPY 타입 추가**: `packages/agents/src/constants/workflow-node-types.ts`
  - [ ] `AGENT_COPY: 'agent_copy'` 상수 추가
  - [ ] 타입 설명 및 의도 주석 추가
  - [ ] `isValidWorkflowNodeType` 함수에 추가

- [ ] **createAgentCopyNode 메서드 구현**: `packages/agents/src/services/workflow-event-subscriber.ts`
  - [ ] Agent Copy 노드 생성 로직 구현
  - [ ] 원본 Agent의 정보를 Copy 노드로 복사
  - [ ] Agent 번호 시스템과 통합

- [ ] **Agent Copy 연결 로직 구현**
  - [ ] Response → Agent Copy 연결 생성
  - [ ] Agent Copy → Output 연결 생성
  - [ ] 교차 연결 방지 로직 완성

### 통합 Tool Call 시스템 완성

- [ ] **createUniversalToolCallNode 완전 개선**: `packages/agents/src/services/workflow-event-subscriber.ts`
  - [ ] 와일드카드 `parentId` 완전 제거
  - [ ] `agentToThinkingMap.get()` 사용으로 교체
  - [ ] Thinking → Tool Call 연결 자동 생성
  - [ ] 오류 처리 및 로깅 개선

- [ ] **모든 Tool Call 생성 통합**
  - [ ] `handleToolCallStart` 단일 메서드로 통합
  - [ ] Sub 관련 분기 로직 완전 제거
  - [ ] 일관된 Tool Call 생성 보장

### 연결 시스템 재구축

- [ ] **Agent 번호 기반 연결 로직 구현**
  - [ ] Agent → Thinking 연결 (이미 구현됨)
  - [ ] Thinking → Tool Call 연결 (새로 구현)
  - [ ] Tool Call → Agent 연결 개선
  - [ ] Agent → Response 연결 개선

- [ ] **real-time-workflow-builder.ts 업데이트**
  - [ ] 레거시 연결 타입 매핑 제거
  - [ ] 새로운 연결 타입 매핑 추가
  - [ ] `subAgentId` 필드 완전 제거
  - [ ] Agent 번호 시스템 반영

### WorkflowConverter 시스템 정리

- [ ] **workflow-converter/index.ts 정리**
  - [ ] Line 378: `'sub_agent'` 매핑 삭제
  - [ ] Line 383: `'sub_tool_call'` 매핑 삭제
  - [ ] Line 440: Sub 관련 아이콘 삭제
  - [ ] Line 459: Sub 관련 색상 삭제

---

## 🔧 Phase 3: 시스템 통합 및 최적화 (Priority: Medium)

### 이벤트 처리 최적화

- [ ] **handleAssistantMessageComplete 최적화**
  - [ ] 모든 sourceType 통합 처리 검증
  - [ ] `createAgentResponseNode` 호출 확인
  - [ ] 연결 생성 로직 검증

- [ ] **Tool Call Response 시스템 활용**
  - [ ] `createToolCallResponseNode` 연결 확인
  - [ ] Tool Call → Tool Response 연결 검증
  - [ ] TOOL_CALL_RESPONSE 타입 적극 활용

### 성능 및 메모리 최적화

- [ ] **불필요한 조건문 제거**
  - [ ] 복잡한 분기 로직 단순화
  - [ ] 중복 검사 로직 제거
  - [ ] 성능 병목 지점 개선

- [ ] **메모리 사용량 최적화**
  - [ ] 중복 노드 생성 방지
  - [ ] 매핑 테이블 효율성 개선
  - [ ] 가비지 컬렉션 최적화

---

## 🧪 Phase 4: 테스트 및 검증 (Priority: Critical)

### 단위 테스트

- [ ] **Tool Call 생성 테스트**
  - [ ] `createUniversalToolCallNode` 정상 동작 확인
  - [ ] `agentToThinkingMap` 연동 테스트
  - [ ] 연결 생성 로직 테스트

- [ ] **Agent 번호 시스템 테스트**
  - [ ] Agent 0, 1, 2 생성 테스트
  - [ ] Agent Copy 노드 생성 테스트
  - [ ] 번호 매핑 시스템 테스트

- [ ] **연결 시스템 테스트**
  - [ ] Agent → Thinking → Tool Call 연결 테스트
  - [ ] Tool Call → Agent → Response 연결 테스트
  - [ ] Response → Agent Copy 연결 테스트

### 통합 테스트

- [ ] **전체 워크플로우 테스트**
  - [ ] `26-playground-edge-verification.ts` 실행
  - [ ] 연결 성공률 80% 이상 달성
  - [ ] 모든 노드 타입 정상 생성 확인

- [ ] **레거시 완전 제거 검증**
  - [ ] Sub 관련 키워드 완전 소거 확인
  - [ ] 빌드 오류 없음 확인
  - [ ] 런타임 오류 없음 확인

### 성능 테스트

- [ ] **처리 속도 측정**
  - [ ] 이전 대비 처리 속도 개선 확인
  - [ ] 메모리 사용량 감소 확인
  - [ ] CPU 사용률 최적화 확인

---

## 📊 Phase 5: 문서화 및 마무리 (Priority: Low)

### 코드 문서화

- [ ] **새로운 아키텍처 문서 작성**
  - [ ] Agent 번호 시스템 설명
  - [ ] 연결 시스템 다이어그램
  - [ ] API 사용법 가이드

- [ ] **주석 업데이트**
  - [ ] 모든 메서드 주석 최신화
  - [ ] 아키텍처 의도 명확화
  - [ ] 사용 예시 추가

### 최종 검증

- [ ] **Playground 테스트 데이터 동기화**
  - [ ] 실제 SDK 출력과 Playground 데이터 일치 확인
  - [ ] "Load Agent Numbering System" 버튼 정상 동작
  - [ ] 시각적 검증 완료

- [ ] **코드 품질 검증**
  - [ ] ESLint 규칙 통과
  - [ ] TypeScript 엄격 모드 통과
  - [ ] 코드 리뷰 완료

---

## 🎯 성공 기준

### 연결 문제 해결 성공 기준

- [ ] **실제 SDK 연결 실패 해결**
  - 현재: `❌ thinking_conv_*_* → tool_call_undefined (executes)`
  - 목표: `✅ thinking_agent_0_* → tool_call_* (executes)`

- [ ] **Agent ID 불일치 문제 해결**  
  - 현재: `❌ agent_0_agent-* → thinking_agent_0_* (processes)`
  - 목표: `✅ agent_0_* → thinking_agent_0_* (processes)`

- [ ] **Sub 시스템 레거시 제거**
  - 현재: `❌ agent_task-aggregator → merge_results_undefined (result)`
  - 목표: `✅ agent_* → response_* (return)` 통일된 연결

- [ ] **Playground 수준 연결 품질 달성**
  - 현재: SDK에서 다수 ❌ 연결, Playground에서 대부분 ✅ 연결
  - 목표: SDK 실행 결과가 Playground 테스트 데이터와 동일한 연결 성공률

### 도메인 중립성 달성 기준

- [ ] **Sub 키워드 완전 제거**
  - `sub-agent`, `subtool`, `sub_response` 등 모든 Sub 개념 제거
  - 통일된 `agent`, `tool_call`, `response` 타입 시스템

- [ ] **빌드 및 실행 성공**
  - 모든 패키지 빌드 오류 없음
  - `26-playground-edge-verification.ts` 실행 성공

---

## 🚨 위험 요소 및 대응책

### 잠재적 위험

- [ ] **타이밍 이슈**: Tool Call 생성 시 Thinking Node 매핑 부재
  - **대응책**: 매핑 존재 검증 로직 추가, 오류 처리 강화

- [ ] **ID 불일치**: 서로 다른 시점 생성 ID 매칭 실패
  - **대응책**: ID 생성 규칙 표준화, 로깅 강화

- [ ] **누락된 엣지 케이스**: 레거시 제거 시 미처 발견하지 못한 의존성
  - **대응책**: 단계별 테스트, 점진적 제거

### 롤백 계획

- [ ] **Git 브랜치 전략**: feature/legacy-removal 브랜치에서 작업
- [ ] **백업 보관**: 현재 상태 태그 생성
- [ ] **단계별 커밋**: 각 Phase별 커밋으로 롤백 지점 확보

---

## 📅 예상 일정

- **Phase 1 (레거시 제거)**: 1일
- **Phase 2 (새 시스템 구축)**: 1-2일  
- **Phase 3 (시스템 통합)**: 0.5일
- **Phase 4 (테스트 및 검증)**: 1일
- **Phase 5 (문서화)**: 0.5일

**총 예상 소요 시간**: 4-5일

---

## 🎉 완료 후 예상 결과

### 연결 문제 해결 완료
- **현재 실패 상태** (실제 로그 기반):
  ```
  ❌ thinking_conv_1754205483540_ketj78w6e_* → tool_call_undefined (executes)
  ❌ agent_0_agent-1754205488139-qtp0iblin → thinking_agent_0_1754205488139 (processes)  
  ❌ thinking_agent-1754205488139-qtp0iblin_* → tool_call_tool-1754205488139-oe51xagft (executes)
  ❌ agent_task-aggregator → merge_results_undefined (result)
  ```
- **목표 성공 상태** (와일드카드 제거 후): 
  ```
  ✅ agent_0_conv_1754205483540_ketj78w6e → thinking_agent_0_1754205483544 (processes)
  ✅ thinking_agent_0_1754205483544 → tool_call_call_FNtCnkDmmsz8T88RjeX5zoUh (executes)  
  ✅ tool_call_call_FNtCnkDmmsz8T88RjeX5zoUh → agent_1_conv_1754205488140_ixw01wgyo (creates)
  ✅ agent_1_conv_1754205488140_ixw01wgyo → thinking_agent_1_1754205488154 (processes)
  ✅ thinking_agent_1_1754205488154 → response_conv_1754205488140_ixw01wgyo (return)
  ```

### 핵심 해결 메커니즘
- **와일드카드 제거**: `thinking_*_*` → `executionToThinkingMap.get(executionId)`
- **정확한 ID 매핑**: `metadata.executionId` 활용으로 정확한 부모-자식 관계 설정
- **이벤트 순서 활용**: `assistant.message_start` → `tool_call_start` 순서 보장 활용

### SDK-Playground 연결 품질 일치
- **현재**: SDK는 다수 ❌ 연결, Playground는 대부분 ✅ 연결
- **목표**: SDK 실행 결과가 Playground 테스트 데이터와 동일한 연결 성공률
- **제거 대상**: `undefined` ID, 와일드카드 패턴, Sub 시스템 레거시

### 도메인 중립성 완성
- **통일된 타입 시스템**: 모든 Node가 `agent`, `tool_call`, `response` 타입 사용
- **Sub 개념 완전 제거**: 혼란을 야기하는 sub-* 키워드 근절
- **Agent 번호 시스템 완성**: Agent 0, 1, 2 체계적 관리

---

**문서 버전**: 1.0  
**작성일**: 2025-01-08  
**최종 업데이트**: 2025-01-08  
**상태**: 작업 준비 완료 ✅