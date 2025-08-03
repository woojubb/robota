# 📋 Robota SaaS 플랫폼 통합 작업 체크리스트

## 🚨 현재 최우선 작업 (2025-01-08 기준)

### Phase 1: Tool Response 연결 복구 (Critical)
- [ ] Tool Response → Merge Results 연결 수정
  - [ ] `toolResponsesByExecution` Map key 일치 문제 해결
  - [ ] Tool Response 저장 시 사용하는 key와 Merge Results 생성 시 조회하는 key 통일
  - [ ] `connectedToolResponses` 배열이 비어있지 않도록 보장
- [ ] 이벤트 순서 보장
  - [ ] `task.aggregation_start` 타이밍 조정
  - [ ] Tool execution 완료 확인 로직 추가
  - [ ] 모든 Tool Response 수집 대기 후 Merge Results 생성

### Phase 2: Agent Numbering System 활성화 (High)
- [ ] AgentCopyManager 활용
  - [ ] Agent 생성 시 `agentCopyManager.assignAgentNumber()` 호출
  - [ ] 생성된 노드에 agentNumber 메타데이터 추가
  - [ ] Agent 0, 1, 2 순차 번호 확인
- [ ] Agent Standard Structure 구현
  - [ ] 각 Agent별 필수 구조 보장 (Agent → Thinking → Tool Call/Response)
  - [ ] 표준 연결 패턴 적용

### Phase 3: Agent Integration Instance 구현 (Medium)
- [ ] Agent 0 Copy (Integration Instance) 생성
  - [ ] Tool Response 통합 지점 생성
  - [ ] `agent_0_copy_1` 노드가 Integration Instance 역할
  - [ ] 모든 Sub-Agent Response를 여기로 집결
- [ ] 교차 연결 방지
  - [ ] Response 노드가 자신의 Agent로만 연결
  - [ ] `response_agent_1_copy_1` → `agent_2_copy_1` 교차 연결 방지

### Phase 4: 중복 및 고립 노드 정리 (Normal)
- [ ] 중복 Merge Results 제거
  - [ ] 단일 Merge Results 노드만 생성
  - [ ] 중복 이벤트 발생 방지
  - [ ] sourceType별 중복 생성 방지
- [ ] User Input 연결
  - [ ] User Input → Team/Agent 0 연결 복구
  - [ ] 전체 워크플로우 시작점 명확화

## 🎯 웹 플랫폼 개발 (우선순위 2)

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

## 🔧 기능 확장 (우선순위 3)

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

## 🏗️ 인프라 및 성능 (우선순위 4)

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

## 🎨 사용자 경험 (우선순위 5)

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

## 📊 분석 및 모니터링 (우선순위 6)

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
**상태**: 🔴 워크플로우 연결 문제 해결 최우선  
**다음 작업**: Phase 1 - Tool Response 연결 복구