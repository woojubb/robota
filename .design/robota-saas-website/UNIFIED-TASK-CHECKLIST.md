# 📋 Robota SaaS 플랫폼 통합 작업 체크리스트

## ✨ 워크플로우 시각화 안정성 확보 (긴급 수정)

- [ ] **1. Fork/Join Point 매핑 시스템 도입**: `tool_result` 노드 중복 생성 및 `thinking_round2` 연결 오류 근본 해결
    - [ ] **1-1. `WorkflowEventSubscriber`에 신규 맵 추가**: `thinkingToToolResultMap` (Thinking Node ID → Tool Result Node ID) 멤버 변수 선언.
    - [ ] **1-2. 보조 함수 `findParentThinkingNodeForAgent` 구현**: `toolCallToAgentMap` 등을 역추적하여 주어진 Agent를 생성한 `thinking` 노드를 찾는 로직 추가.
- [ ] **2. 레거시 코드 및 로직 정리**: 오류 발생 가능성이 높은 복잡한 로직 제거
    - [ ] **2-1. `updateMergeResultsForNewAgentResponse` 함수 완전 삭제**: 불필요하고 복잡한 추측성 연결 로직 제거.
    - [ ] **2-2. `createToolResultNode` 함수 역할 축소**: 다른 함수에서 호출될 때 순수하게 노드를 생성하는 역할에만 집중하도록 로직 단순화.
- [ ] **3. `handleToolResultAggregationStart` 로직 재설계**: 단일 합류점(Join Point) 생성 및 관리 책임 부여
    - [ ] **3-1. `findParentThinkingNodeForAgent` 호출**: 이벤트를 발생시킨 Agent의 부모 `thinking` 노드 ID (Fork Point)를 조회.
    - [ ] **3-2. `thinkingToToolResultMap` 확인**: 부모 `thinking` 노드에 해당하는 `tool_result` 노드(Join Point)가 이미 생성되었는지 확인.
    - [ ] **3-3. `tool_result` 노드 조건부 생성**: Join Point가 없을 경우에만 `createToolResultNode`를 호출하여 **최초 1회** 생성하고 `thinkingToToolResultMap`에 등록.
    - [ ] **3-4. `response` 노드 연결**: 현재 Agent의 `response` 노드를 Join Point(`tool_result`)에 연결.
- [ ] **4. `createAgentThinkingNode` 로직 수정**: `thinking_round2`의 정확한 연결 보장
    - [ ] **4-1. `thinkingToToolResultMap` 조회**: `round > 1`일 경우, 이전 라운드 `thinking` 노드 ID를 키로 사용하여 `thinkingToToolResultMap`에서 연결할 `tool_result` 노드 ID 조회.
    - [ ] **4-2. `analyze` 타입 연결 생성**: 조회된 `tool_result` 노드와 현재 `thinking_round2` 노드를 `analyze` 타입으로 연결.
    - [ ] **4-3. "사용 후 정리" 로직 구현**: 연결에 사용된 `tool_result` 맵 항목을 `thinkingToToolResultMap`에서 삭제하여 메모리 누수 방지 및 상태 관리.
- [ ] **5. 전체 시스템 검증**
    - [ ] **5-1. `packages/agents` 빌드**: 수정된 `WorkflowEventSubscriber`가 포함된 패키지 빌드.
    - [ ] **5-2. `05-team-collaboration-ko.ts` 예제 실행**: 수정된 로직으로 예제 실행.
    - [ ] **5-3. `real-workflow-data.json` 분석**: 실행 결과 데이터에서 `tool_result`가 1개만 생성되고 `thinking_round2`가 해당 노드에 올바르게 연결되었는지 검증.

## 🎯 웹 플랫폼 개발 (우선순위 1)

### 플레이그라운드 기능
- [ ] 에이전트 설정 UI와 워크플로우 시각화 연동
- [ ] 실시간 채팅 + 워크플로우 동시 표시
- [ ] 워크플로우 진행 상태 애니메이션
- [ ] 에러 발생 시 워크플로우에 에러 노드 표시
- [ ] 워크플로우 저장 및 다시보기 기능

### 대시보드 개발
- [ ] 사용자별 에이전트 실행 히스토리
- [ ] 워크플로우 성능 메트릭 시각화
- [ ] 크레딧 사용량과 워크플로우 복잡도 연관 분석
- [ ] 팀 협업을 위한 워크플로우 공유 기능

### 프론트엔드 통합
- [ ] React 컴포넌트에서 RealTimeMermaidGenerator 통합
- [ ] 실시간 워크플로우 시각화 UI 컴포넌트 개발
- [ ] WebSocket을 통한 실시간 다이어그램 업데이트
- [ ] 워크플로우 인터렉션 기능 (노드 클릭, 확대/축소)
- [ ] 다크모드 지원 Mermaid 테마 적용

## 🔧 기능 확장 (우선순위 2)

### 워크플로우 고도화
- [ ] 커스텀 Node 타입 추가 지원
- [ ] 워크플로우 템플릿 저장 및 재사용
- [ ] 워크플로우 비교 기능 (A/B 테스트)
- [ ] 워크플로우 성능 분석 도구
- [ ] 브랜치별 실행 시간 및 비용 추적

### AI 모델 확장
- [ ] 추가 AI 프로바이더 지원 (Claude, Gemini 등)
- [ ] 모델별 성능 비교 워크플로우
- [ ] 모델 전환 시 워크플로우 영향 분석
- [ ] 프로바이더별 비용 최적화 권장사항

### Team 기능 강화
- [ ] 복잡한 Team 구조 시각화 (다단계 assignTask)
- [ ] Team 성능 메트릭 및 병목 분석
- [ ] Team 구성원별 역할 시각화
- [ ] 동적 Team 재구성 워크플로우

## 🏗️ 인프라 및 성능 (우선순위 3)

### 성능 최적화
- [ ] 대규모 워크플로우 (100+ 노드) 최적화
- [ ] 워크플로우 렌더링 가상화
- [ ] 워크플로우 데이터 압축 및 캐싱
- [ ] 클라이언트 사이드 워크플로우 처리 최적화

### 확장성
- [ ] 워크플로우 서버 사이드 렌더링 (SSR)
- [ ] 워크플로우 데이터 스트리밍
- [ ] 분산 워크플로우 처리 시스템
- [ ] 워크플로우 메트릭 수집 및 분석

### 보안
- [ ] 워크플로우 데이터 암호화
- [ ] 사용자별 워크플로우 접근 권한
- [ ] API 키 및 민감 정보 마스킹
- [ ] 워크플로우 실행 로그 보안

## 🎨 사용자 경험 (우선순위 4)

### UI/UX 개선
- [ ] 워크플로우 노드 커스터마이징
- [ ] 드래그 앤 드롭 워크플로우 편집기
- [ ] 워크플로우 미리보기 및 시뮬레이션
- [ ] 모바일 친화적 워크플로우 뷰어

### 접근성
- [ ] 키보드 내비게이션 지원
- [ ] 스크린 리더 호환성
- [ ] 고대비 모드 지원
- [ ] 다국어 지원 (i18n)

### 온보딩
- [ ] 워크플로우 튜토리얼 및 가이드
- [ ] 샘플 워크플로우 템플릿
- [ ] 인터랙티브 데모
- [ ] 도움말 및 문서 통합

## 📊 분석 및 모니터링 (우선순위 5)

### 사용자 분석
- [ ] 워크플로우 사용 패턴 분석
- [ ] 사용자 행동 추적
- [ ] A/B 테스트 시스템
- [ ] 사용자 피드백 수집

### 시스템 모니터링
- [ ] 워크플로우 성능 모니터링
- [ ] 오류 추적 및 알림
- [ ] 리소스 사용량 모니터링
- [ ] SLA 및 uptime 추적

### 비즈니스 메트릭
- [ ] 사용량 기반 요금제 설계
- [ ] ROI 및 비즈니스 가치 측정
- [ ] 고객 성공 지표 추적
- [ ] 경쟁 분석 및 벤치마킹

---

**문서 업데이트**: 2025-01-08  
**상태**: 🎯 웹 플랫폼 개발 최우선  
**다음 작업**: 플레이그라운드 기능 개발 및 대시보드 구현
