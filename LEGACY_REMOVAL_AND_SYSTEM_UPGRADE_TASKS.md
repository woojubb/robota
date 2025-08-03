# Workflow 연결 문제 해결 작업 목록 (v3.0)

## 📋 프로젝트 개요

**최종 목표**: Load Agent Numbering System 버튼과 동일한 완벽한 워크플로우 구조 달성

**현재 상황** (2025-01-08 최신 분석):
- ✅ **Invalid Edges 해결**: 0/18 (100% 유효)
- ❌ **구조적 문제**: Tool Response 연결 단절, 교차 연결, 중복 노드
- ❌ **시스템 미활용**: Agent Numbering System, Agent Copy Manager

## 🚨 Phase 1: Tool Response 연결 복구 (최우선)

### 문제: Tool Response가 Merge Results와 연결되지 않음

#### Task 1.1: ID 추적 시스템 수정
- [ ] `toolResponsesByExecution` Map key 일치 문제 해결
  - [ ] Tool Response 저장 시 사용하는 key 확인
  - [ ] Merge Results 생성 시 조회하는 key 확인  
  - [ ] 일관된 key 체계로 통일 (rootExecutionId 우선)

#### Task 1.2: 이벤트 순서 보장
- [ ] `task.aggregation_start` 타이밍 조정
  - [ ] Tool execution 완료 확인 로직 추가
  - [ ] 모든 Tool Response 수집 대기
  - [ ] 수집 완료 후 Merge Results 생성

#### Task 1.3: Tool Response 연결 생성
- [ ] `createMergeResultsNode` 수정
  - [ ] `connectedToolResponses` 배열이 비어있지 않도록 보장
  - [ ] Tool Response → Merge Results 연결 확실히 생성
  - [ ] 디버그 로그 추가하여 추적 과정 확인

## 🔧 Phase 2: Agent Numbering System 활성화

### 문제: agentNumber가 모두 null

#### Task 2.1: AgentCopyManager 활용
- [ ] Agent 생성 시 `agentCopyManager.assignAgentNumber()` 호출
- [ ] 생성된 노드에 agentNumber 메타데이터 추가
- [ ] Agent 0, 1, 2 순차 번호 확인

#### Task 2.2: Agent Standard Structure 구현
- [ ] 각 Agent별 필수 구조 보장
  - [ ] Agent → Thinking (필수)
  - [ ] Thinking → Tool Call 또는 Response
  - [ ] 표준 연결 패턴 적용

## 🔄 Phase 3: Agent Integration Instance 구현

### 문제: 교차 연결 및 복잡한 구조

#### Task 3.1: Agent 0 Copy (Integration Instance) 생성
- [ ] Tool Response 통합 지점 생성
- [ ] `agent_0_copy_1` 노드가 Integration Instance 역할
- [ ] 모든 Sub-Agent Response를 여기로 집결

#### Task 3.2: 교차 연결 방지
- [ ] Response 노드가 자신의 Agent로만 연결
- [ ] `response_agent_1_copy_1` → `agent_1_copy_1` (올바름)
- [ ] `response_agent_1_copy_1` → `agent_2_copy_1` (방지)

## 🧹 Phase 4: 중복 및 고립 노드 정리

### 문제: Merge Results 4개 중복, User Input 고립

#### Task 4.1: 중복 Merge Results 제거
- [ ] 단일 Merge Results 노드만 생성
- [ ] 중복 이벤트 발생 방지
- [ ] sourceType별 중복 생성 방지

#### Task 4.2: User Input 연결
- [ ] User Input → Team/Agent 0 연결 복구
- [ ] 전체 워크플로우 시작점 명확화
- [ ] `scheduleUserInputConnection` 로직 검증

## ✅ 완료된 작업들 (제거)

### 이미 구현된 시스템들
- ✅ **이벤트 시스템 개선**: Invalid Edges 0개 달성
- ✅ **Tool Response 추적 기본 구조**: `toolResponsesByExecution` Map
- ✅ **Agent 번호 체계**: `agent_0_copy_1`, `agent_1_copy_1`, `agent_2_copy_1`
- ✅ **도메인 중립성**: 모든 타입 통일
- ✅ **비동기 이벤트 처리**: setTimeout으로 블로킹 방지

### 제거된 레거시
- ✅ Sub 키워드 완전 제거
- ✅ 와일드카드 패턴 제거
- ✅ task-aggregator 하드코딩 제거

## 📊 성공 지표

### 정량적 지표
- [ ] Tool Response 연결: 2개 모두 Merge Results와 연결
- [ ] Agent 번호: 3개 Agent 모두 agentNumber 설정
- [ ] 교차 연결: 0개 (모든 Response가 올바른 Agent로)
- [ ] 중복 노드: Merge Results 1개로 통합
- [ ] User Input: Agent 0와 연결

### 구조적 지표
```
✅ 목표 구조:
User Input → Agent 0 → Thinking → Tool Call × 2
                                      ↓
                                Tool Response × 2
                                      ↓
                                Merge Results
                                      ↓
                                Agent 0 Copy
                                      ↓
                                Final Response
```

## 🚀 작업 순서

1. **Tool Response 연결 복구** (가장 시급)
2. **Agent Numbering 활성화** (구조 개선)
3. **Integration Instance 구현** (시각화 개선)
4. **중복/고립 정리** (마무리)

## 📅 예상 일정

- Phase 1: 0.5일 (Tool Response 연결)
- Phase 2: 0.5일 (Agent Numbering)
- Phase 3: 1일 (Integration Instance)
- Phase 4: 0.5일 (정리 작업)

**총 예상 시간**: 2.5일

---

**문서 버전**: 3.0  
**작성일**: 2025-01-08  
**상태**: 🔴 구조적 문제 해결 필요