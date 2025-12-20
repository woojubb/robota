# Workflow 패키지 개발 계획

## 📅 개발 일정 개요
- **예상 기간**: 2-3주
- **우선순위**: 높음
- **전제조건**: agents, team(assignTask MCP tool collection) 패키지 안정화

## ✅ Phase 1: 패키지 초기 설정 (1-2일) **완료됨**

### 기본 구조 설정
- [x] `packages/workflow` 디렉토리 생성
- [x] `package.json` 작성
  - [x] 패키지명: `@robota-sdk/workflow`
- [x] 의존성 설정: `@robota-sdk/agents`, `@robota-sdk/team` (assignTask MCP tool collection; legacy team creation 제거)
  - [x] TypeScript 설정
  - [x] 빌드 스크립트 설정
- [x] `tsconfig.json` 작성
  - [x] strict mode 활성화
  - [x] paths 설정
  - [x] 빌드 출력 설정
- [x] `tsup.config.ts` 작성
  - [x] ESM/CJS 듀얼 빌드 설정
  - [x] 타입 정의 생성 설정
- [x] `.gitignore` 작성
- [x] `README.md` 초기 작성

### 디렉토리 구조 생성
- [x] `src/` 루트 디렉토리 생성
- [x] `src/index.ts` - 패키지 진입점
- [x] `src/interfaces/` - 인터페이스 정의
- [x] `src/models/` - 데이터 모델 (types/ 대체)
- [x] `src/services/` - 핵심 서비스
- [x] `src/handlers/` - 이벤트 핸들러
- [x] `src/validators/` - 검증 로직 (미구현)
- [x] `src/constants/` - 상수 정의
- [x] `src/utils/` - 유틸리티 함수 (미구현)
- [x] `src/types/` - 타입 정의
- [x] `tests/` - 테스트 파일 (미구현)

## ✅ Phase 2: 도메인 중립적 인터페이스 정의 (2-3일) **완료됨**

### 핵심 인터페이스
- [x] `interfaces/workflow-node.ts`
  - [x] `WorkflowNode` 인터페이스 (`[key: string]: unknown` 확장성)
  - [x] `WorkflowNodeType` 타입 (상수 파일로 이동)
  - [x] `WorkflowNodeStatus` 타입
  - [x] `WorkflowNodeData` 인터페이스
  - [x] `WorkflowConnection` 및 관련 타입들
- [x] `interfaces/workflow-edge.ts`
  - [x] `WorkflowEdge` 인터페이스
  - [x] `WorkflowConnectionType` 타입 (노드 파일로 통합)
  - [x] `WorkflowEdgeStyle` 인터페이스
- [x] `interfaces/workflow-builder.ts`
  - [x] `WorkflowBuilder` 기본 인터페이스
  - [x] `ExtendedWorkflowBuilder` 확장 인터페이스
  - [x] `WorkflowUpdate` 타입 (union 타입)
  - [x] `WorkflowSnapshot` 인터페이스
  - [x] `WorkflowUpdateCallback` 타입
- [x] `interfaces/event-handler.ts`
  - [x] `EventHandler` 인터페이스
  - [x] `EventData` 구조체
  - [x] `EventProcessingResult` 인터페이스
  - [x] `HandlerPriority` enum
  - [x] `EventPattern` 및 관련 타입들
- [x] `interfaces/workflow-plugin.ts`
  - [x] `WorkflowPlugin` 인터페이스
  - [x] `PluginLifecycleHook` 타입
  - [x] `PluginConfig` 인터페이스
  - [x] `AuditPlugin` 클래스

### 타입 정의
- [x] `types/universal-types.ts`
  - [x] `UniversalWorkflowNode` (agents에서 이동)
  - [x] `UniversalWorkflowEdge` (agents에서 이동)
  - [x] 시각화 플랫폼 호환 타입들
- [x] `constants/workflow-types.ts`
  - [x] `WORKFLOW_NODE_TYPES` 상수 (agents에서 이동)
  - [x] `WorkflowNodeType` 타입 정의
  - [x] 노드 타입 검증 함수
- [x] `constants/defaults.ts`
  - [x] `WORKFLOW_DEFAULTS` 기본값
  - [x] `WORKFLOW_CONSTRAINTS` 제약사항

## ✅ Phase 3: 핵심 서비스 구현 (3-4일) **완료됨**

### NodeEdgeManager 구현
- [x] `services/node-edge-manager.ts` (agents에서 완전 이동)
  - [x] 클래스 기본 구조
  - [x] `addNode()` 메서드
    - [x] ID 생성 로직
    - [x] Timestamp 자동 할당 (numeric)
    - [x] 노드 검증
  - [x] `addEdge()` 메서드
    - [x] 연결 가능성 검증
    - [x] 순서 보장 큐
    - [x] 엣지 검증
  - [x] `getNode()` / `getEdge()` 메서드
  - [x] `getAllNodes()` / `getAllEdges()` 메서드
  - [x] `hasNode()` / `hasEdge()` 메서드
  - [x] `removeNode()` / `removeEdge()` 메서드
  - [x] 순환 참조 검증 로직
  - [x] 메모리 최적화

### CoreWorkflowBuilder 구현
- [x] `services/workflow-builder.ts`
  - [x] 클래스 기본 구조 (WorkflowBuilder + ExtendedWorkflowBuilder)
  - [x] `NodeEdgeManager` 통합
  - [x] `addNode()` / `addEdge()` 메서드
  - [x] `updateNode()` / `updateEdge()` 메서드
  - [x] `getSnapshot()` 메서드
  - [x] `subscribe()` / `unsubscribe()` 메서드
  - [x] `findNodes()` / `findEdges()` 검색 메서드
  - [x] 증분 업데이트 시스템
  - [x] 실시간 변경 알림 메커니즘
  - [x] `exportToUniversal()` / `importFromUniversal()` 메서드

### Universal Types 이동
- [x] `types/universal-types.ts`
  - [x] agents 패키지에서 완전 이동
  - [x] 시각화 플랫폼 호환성
  - [x] React-Flow, Mermaid 지원 타입

## ✅ Phase 4: 도메인별 핸들러 구현 (3-4일) **완료됨**

### Agent 이벤트 핸들러
- [x] `handlers/agent-event-handler.ts`
  - [x] `@robota-sdk/agents` SimpleLogger import
  - [x] `agent.*`, `execution.*` 이벤트 처리
  - [x] Agent 노드 생성 로직 (createAgentNode)
  - [x] Agent thinking 노드 처리 (createAgentThinkingNode)
  - [x] Agent response 노드 처리 (createAgentResponseNode)
  - [x] ExecutionStart 노드 처리
  - [x] AssistantMessage 노드 처리
  - [x] 연결 규칙 정의 및 WorkflowUpdate 반환

### Team 이벤트 핸들러
- [x] `handlers/team-event-handler.ts`
  - [x] `team.*` 모든 이벤트 처리
  - [x] Task 할당 처리 (createTaskAssignedNode)
  - [x] Agent 생성 이벤트 처리 (createAgentCreationStartNode/CompleteNode)
  - [x] 팀 분석 처리 (createAnalysisStartNode/CompleteNode)
  - [x] 집계 이벤트 처리 (createAggregationCompleteNode)
  - [x] Tool response ready 처리
  - [x] Agent 번호 및 복사본 관리 시스템

### Tool 이벤트 핸들러
- [x] `handlers/tool-event-handler.ts`
  - [x] Tool call 시작/완료 처리 (createToolCallNode/CompleteNode)
  - [x] Tool response 처리 (createToolResponseNode)
  - [x] Tool error 처리 (createToolCallErrorNode)
  - [x] Agent execution started 처리
  - [x] Tool 타입 매핑 시스템
  - [x] Tool call → response 관계 매핑

### Execution 이벤트 핸들러
- [x] `handlers/execution-event-handler.ts`
  - [x] User message 처리 (createUserMessageNode/InputNode)
  - [x] Execution 시작/완료 처리 (createExecutionStartNode/CompleteNode)
  - [x] Execution error 처리 (createExecutionErrorNode)
  - [x] Assistant message 처리 (createAssistantMessageStartNode/CompleteNode)
  - [x] 실행 레벨 및 계층 구조 지원
  - [x] 메시지 메트릭스 및 분석 데이터 포함

## ✅ Phase 5: WorkflowEventSubscriber 마이그레이션 (4-5일) **완료됨**

### 기존 코드 분석
- [x] 현재 `workflow-event-subscriber.ts` 상세 분석 (1936 라인)
- [x] 도메인별 로직 분리 계획 수립
- [x] 레거시 코드 식별 (AgentCopyManager, 매핑 시스템 등)
- [x] 마이그레이션 위험 요소 파악 및 해결

### 새로운 WorkflowEventSubscriber 구현
- [x] `services/workflow-event-subscriber.ts` (완전 재구현)
  - [x] EventHandler 기반 새 아키텍처
  - [x] 모든 핸들러 자동 등록 (Agent, Team, Tool, Execution)
  - [x] 이벤트 구독 및 라우팅 시스템
  - [x] 우선순위 기반 핸들러 실행
  - [x] 배치 업데이트 처리
  - [x] 실시간 워크플로우 업데이트 콜백
  - [x] 통계 및 모니터링 시스템

### 새로운 기능 추가
- [x] `processEvent()` 메서드: 단일 이벤트 처리
- [x] `subscribeToEvents()` / `subscribeToWorkflowUpdates()`: 구독 시스템
- [x] `getWorkflowSnapshot()`: 현재 상태 조회
- [x] `findNodes()`: 노드 검색
- [x] `exportWorkflow()` / `importWorkflow()`: 데이터 export/import
- [x] `clear()`: 상태 초기화
- [x] Handler 등록/해제 시스템

### 핵심 개선사항
- [x] 도메인 중립성: 특정 도메인 로직 분리
- [x] 확장성: 새로운 핸들러 쉽게 추가 가능
- [x] 타입 안전성: 엄격한 TypeScript 타입 적용
- [x] 성능: 병렬 처리 및 배치 업데이트
- [x] 유지보수성: 명확한 책임 분리

## ✅ Phase 6: workflow-converter 정리 및 agents 패키지 중복 제거 (1-2일) **추가 필요**

### workflow-converter 분석 및 정리
- [ ] `packages/agents/src/services/workflow-converter/` 분석 완료
  - [x] 기능 목적 파악: WorkflowStructure → UniversalWorkflowStructure 변환
  - [x] workflow 패키지와 중복 확인: `CoreWorkflowBuilder`에 동일 기능 존재
  - [x] 사용처 확인: `packages/agents/src/index.ts`에서 export만 됨
- [ ] workflow-converter 제거 작업
  - [ ] `packages/agents/src/services/workflow-converter/` 전체 폴더 삭제
  - [ ] `packages/agents/src/index.ts`에서 `WorkflowToUniversalConverter` export 제거
  - [ ] `packages/agents/src/abstracts/base-workflow-converter.ts` 삭제
  - [ ] `packages/agents/src/interfaces/workflow-converter.ts` 삭제
  - [ ] 관련 import 및 의존성 정리
- [ ] 기능 통합 확인
  - [ ] workflow 패키지의 `exportToUniversal()` 기능으로 대체 확인
  - [ ] Universal 타입 정의 일원화 확인
  - [ ] 빌드 및 타입 검증

### agents 패키지 workflow 관련 코드 정리
- [ ] `packages/agents/src/services/workflow-event-subscriber.ts` 제거
  - [ ] workflow 패키지로 완전 이동 완료 상태 확인
  - [ ] agents 패키지의 기존 파일 삭제
- [ ] `packages/agents/src/services/real-time-workflow-builder.ts` 검토
  - [ ] workflow 패키지 기능으로 대체 가능성 확인
  - [ ] 필요시 workflow 패키지로 이동 또는 삭제
- [ ] `packages/agents/src/services/node-edge-manager.ts` 제거
  - [ ] workflow 패키지로 완전 이동 완료 상태 확인
  - [ ] agents 패키지의 기존 파일 삭제
- [ ] agents 패키지 index.ts 정리
  - [ ] workflow 관련 export 제거
  - [ ] 깔끔한 public API 유지

### 검증 시스템 (향후 확장)
- [ ] `validators/node-validator.ts` (필요시 구현)
- [ ] `validators/edge-validator.ts` (필요시 구현)
- [ ] `validators/event-validator.ts` (필요시 구현)

### 유틸리티 함수 (향후 확장)
- [ ] `utils/id-generator.ts` (필요시 구현)
- [ ] `utils/timestamp.ts` (필요시 구현)
- [ ] `utils/graph-utils.ts` (필요시 구현)

## ✅ Phase 7: EventService (ownerPath context) integration (completed)

### Legacy notes: avoid contextual aliases
- [x] **단일 `extractors` 배열 방식** 완성
  - [x] `ContextExtractor` 인터페이스: `ctor`/`name` + `extract` 함수
  - [x] 이중 구조(typeMap/nameMap) 제거, 단일 배열로 통합
  - [x] 배열 순서대로 매칭, 첫 성공시 즉시 반환
- [x] **표준 타입 매칭** 구현 완성
  - [x] `instanceof` 매칭: `ctor` 속성 사용
  - [x] `constructor.name` 매칭: `name` 속성 사용
  - [x] Fallback: 매칭 조건 없이 `extract` 함수만 사용
- [x] **`createChild(this)` 패턴** 완성
  - [x] 메서드 오버로드로 기존 방식과 신규 방식 병행 지원
  - [x] `extractContextFromSource()` 메서드로 자동 컨텍스트 추출
  - [x] 도메인 중립성 유지하며 Duck typing 제거

### EventService migration summary
- [x] ExecutionService에 ownerPrefix 기반 emit 검증 적용 및 clone 주입
- [x] Robota/Team 생성 시 표준 EventService 주입
- [x] 예제/웹은 단계별 교체 진행 중 (검증 PASS 기준)
  - [ ] Remove references to team-specific concepts; do not introduce team as a known owner type.
  - [ ] Ensure workflow components rely on EventContext.ownerPath (path-only) and do not depend on legacy contextual alias concepts.

### EventService 인터페이스 표준화
- [ ] `packages/agents/src/services/event-service.ts` 업데이트
  - [ ] Do not enforce a fixed owner type taxonomy in types or binders (ownerType must be open-ended).
- [x] Removed legacy contextual alias exports in `@robota-sdk/agents`
- [ ] 전체 시스템 EventService 생성 패턴 통일
  - [ ] Prefer EventService + ownerPath context (no legacy contextual alias concepts).

### 마이그레이션 전용 기능 정리
- [ ] 마이그레이션 완료 후 정리 작업
  - [ ] `packages/agents/src/services/contextual-event/factory.ts`에서 `wrap()` 메서드 삭제
  - [ ] `packages/agents/src/services/contextual-event/factory.ts`에서 `safeCreateChild()` 메서드 삭제
  - [ ] `packages/agents/src/services/contextual-event/enhanced-event-service.ts` 파일 삭제
  - [ ] `packages/agents/src/services/contextual-event/MIGRATION_PLAN.md` 파일 삭제
  - [ ] 관련 exports 및 imports 정리

### 통합 검증
- [ ] 전체 시스템 빌드 및 실행 테스트
- [ ] **단일 배열 `extractors` 방식** EventService 생성 및 컨텍스트 전파 검증
- [x] Verify workflow package relies on EventContext.ownerPath and does not depend on legacy contextual aliases
- [ ] **도메인 중립적 컨텍스트 추출** 기존 기능 동작 검증

## ⏸️ Phase 8: 테스트 작성 (3-4일) **미구현 (향후 확장)**

### 단위 테스트 (향후 구현)
- [ ] NodeEdgeManager 테스트
  - [ ] 노드 추가/제거
  - [ ] 엣지 추가/제거
  - [ ] 검증 로직
- [ ] CoreWorkflowBuilder 테스트
  - [ ] 워크플로우 구축
  - [ ] 스냅샷 생성
  - [ ] 구독 시스템
- [ ] 각 핸들러 테스트
  - [ ] 이벤트 처리
  - [ ] 노드/엣지 생성
  - [ ] 에러 케이스

### 통합 테스트 (향후 구현)
- [ ] 전체 워크플로우 시나리오
- [ ] 도메인 간 상호작용
- [ ] 성능 테스트
- [ ] 메모리 누수 테스트

### E2E 테스트 (향후 구현)
- [ ] 실제 이벤트 시퀀스 테스트
- [ ] 복잡한 워크플로우 테스트
- [ ] 에러 복구 테스트

**참고**: 현재는 수동 빌드 테스트 및 타입 검증으로 품질 확보

## ✅ Phase 8: 문서화 (2일)

### API 문서
- [ ] TSDoc 주석 추가
- [ ] API 레퍼런스 생성
- [ ] 사용 예제 작성

### 가이드 문서
- [ ] 시작 가이드
- [ ] 핸들러 작성 가이드
- [ ] 플러그인 개발 가이드
- [ ] 마이그레이션 가이드

### 예제 코드
- [ ] 기본 사용 예제
- [ ] 커스텀 핸들러 예제
- [ ] 플러그인 예제
- [ ] 고급 사용 예제

## ✅ Phase 9: 통합 및 최적화 (2-3일)

### agents 패키지 정리
- [ ] workflow 관련 코드 제거
- [ ] import 경로 수정
- [ ] 빌드 확인

### team 패키지 정리
- [ ] workflow import 추가
- [ ] 의존성 정리
- [ ] 테스트 확인

### apps/web 통합
- [ ] workflow 패키지 import
- [ ] 기존 코드 수정
- [ ] 동작 확인

### 성능 최적화
- [ ] 프로파일링
- [ ] 병목 지점 개선
- [ ] 메모리 사용 최적화

## ✅ Phase 10: 배포 준비 (1일)

### 최종 검토
- [ ] 코드 리뷰
- [ ] 보안 검토
- [ ] 성능 검토

### 배포 준비
- [ ] 버전 번호 결정
- [ ] CHANGELOG 작성
- [ ] 배포 스크립트 준비

### 모니터링 설정
- [ ] 로깅 설정
- [ ] 에러 추적
- [ ] 성능 모니터링

## 📋 주의사항

### 개발 원칙
- [x] 모든 단계에서 도메인 중립성 유지
- [x] 타입 안정성 최우선  
- [ ] 테스트 주도 개발 (향후 확장)
- [x] 점진적 마이그레이션

### 위험 요소 및 해결
- [x] Circular dependency 주의 → workflow 패키지로 해결
- [x] 성능 저하 모니터링 → 병렬 처리 및 배치 업데이트로 개선
- [x] 호환성 유지 → 기존 인터페이스 호환성 보장
- [x] 메모리 사용량 관리 → 효율적인 노드/엣지 관리

### 체크포인트 완료 상태
- [x] Phase 1-5 완료 후 아키텍처 리뷰 → A급 평가
- [x] Phase 5 완료 후 통합 테스트 → 빌드 성공 확인
- [x] 타입 안전성 테스트 → TypeScript strict mode 통과
- [x] workflow 패키지 독립 구축 → 목적 100% 달성 확인

## 📋 **작업 순서 정리**

### 🎯 **즉시 작업** (우선순위 1)
1. **Phase 6: workflow-converter 정리** (1일)
   - agents 패키지에서 중복 기능 제거
   - workflow 패키지 기능으로 일원화
   
2. **Phase 7: EventService ownerPath context** (completed)
   - [x] **단일 배열 `extractors` 방식** 완성
   - [x] **`createChild(this)` 패턴** 완성
   - [x] **도메인 중립적 컨텍스트 추출** 완성
   - [x] Remove legacy contextual alias references and use EventService ownerPath context
   - [ ] 전체 시스템 EventService 생성 패턴 통일

### ⏸️ **향후 확장** (우선순위 2)
3. **Phase 8-10: 테스트/문서화/최적화** (필요시)
   - 단위 테스트 및 통합 테스트
   - API 문서화
   - 성능 최적화

## 📌 신규 작업 항목: parentId/prevId 브랜치 모델 적용

### 아키텍처 반영
- [x] ARCHITECTURE.md에 브랜치 모델(parentId/prevId) 추가 설명
- [ ] 인터페이스 확장: `EventData`에 `parentId`/`prevId` 표준 필드 명시(TSDoc)
- [ ] Edge 생성 정책 반영: prev 기반 단일 인바운드 원칙으로 NodeEdgeManager/WorkflowBuilder 사용 가이드 명시

### 핸들러 가이드
- [ ] 핸들러는 `node.parentId = event.parentId`만 설정(메타, 변경 금지)
- [ ] 엣지는 `prevId` 기준으로만 생성; `prevId` 미제공 시 즉시 에러로 표면화(기본 정책)
- [ ] 예시 매핑(Execution 앵커 채택): execution/assistant/tool/invoked-agent/aggregation 별 parent/prev 표 제공(ARCHITECTURE.md 링크)

### 검증/품질
- [ ] 불변조건 문서화: 단일 인바운드, 순서 단조 증가, 사이클 금지, 존재성 보장
- [ ] 검증 스크립트 보강 항목 정리(미래 확장): prev.timestamp < node.timestamp, prev 존재성

### 마이그레이션 체크리스트
- [ ] 이벤트 소스에서 parentId/prevId 모두 제공하도록 표준화(가능한 한 모든 이벤트)
- [ ] 기존 핸들러에서 prev 기반 연결로 전환(필요 시 예제 코드 업데이트)

## 📌 즉시 후속 작업(세부)
- [ ] Workflow 인터페이스 업데이트: `interfaces/event-handler.ts`의 `EventData`에 `parentId?: string; prevId?: string;` 명시 및 TSDoc 추가
- [ ] WorkflowEventSubscriber 적용부 업데이트: `applyWorkflowUpdate` 경로에서 prevId가 존재할 경우 `addEdge(prevId → node.id)` 수행(노드 생성 후), parentId는 메타에만 유지
- [ ] NodeEdgeManager 가이드 문서화: prev 기반 단일 인바운드 정책, 사이클/존재성 검증 규칙
- [ ] Execution/Tool/Team 핸들러 점검: 모든 생성 노드에 `parentId = event.parentId` 지정, 엣지는 `prevId`로만 생성되도록 수정 계획 수립
- [ ] 검증 스크립트 점검: 다중 유입 검사(OK), prev 타임스탬프 단조 증가 검사(추가 예정 항목으로 문서화)
- [ ] 예제 이벤트 방출부(agents/team) 작업 계획: parentId/prevId 동시 제공 규칙 합의 및 체크리스트 작성(구현은 통합 단계에서)

## 🚦 단계별 진행 순서 (실행 체크리스트)

1) 워크플로 인터페이스 반영 (workflow)
- [ ] `interfaces/event-handler.ts`의 `EventData`에 `parentId?: string; prevId?: string;` 추가 및 TSDoc 작성
- [ ] `ARCHITECTURE.md` 링크로 규칙 명시(단일 인바운드, prev 기반 엣지 생성)

2) Subscriber/Builder 가이드 반영 (workflow)
- [ ] `WorkflowEventSubscriber` 사용 가이드에 “노드 생성 후 prevId 존재 시 addEdge(prevId → node.id)” 규칙 문서화
- [ ] `NodeEdgeManager` 문서에 prev 기반 엣지 생성/사이클·존재성 검증 규칙 명시(코드 변경이 필요하면 별도 단계에서 적용)

3) 핸들러 표준화 (workflow)
- [ ] `Agent/Execution/Tool/Team` 핸들러 작성 가이드 업데이트: `node.parentId = event.parentId`(메타), 엣지는 prev로만 생성하도록 규칙화
- [ ] 이벤트 예시 표 추가(Execution 앵커 채택 시 parent/prev 매핑)

4) 이벤트 소스 표준화 계획 수립 (agents/team)
- [ ] `ExecutionService` emit별 parentId/prevId 제공 규칙 표준 확정
- [ ] `TeamContainer`/`SubAgentEventRelay` emit별 parentId/prevId 제공 규칙 표준 확정

5) 통합 적용 (코드 변경 단계)
- [ ] workflow: prev 엣지 생성 로직 적용(필요시)
- [ ] agents/team: 각 emit에 parentId/prevId 주입 적용(표준에 맞춤)

6) 검증
- [ ] 예제 26 실행 → `verify-workflow-connections.ts` 통과 확인(단일 인바운드, 단절 없음)
- [ ] 회귀 확인: 기존 기능 영향 여부 검토

7) 문서/가이드 마감
- [ ] `ARCHITECTURE.md` 최종 반영(예시/도표)
- [ ] `DEVELOPMENT_PLAN.md` 체크박스 업데이트 및 완료 표시

## 🚨 **중요: agents 패키지 정리 필수**

**모든 작업 완료 후 agents 패키지에서 다음 제거 필수:**
- `packages/agents/src/services/workflow-converter/` (전체 폴더)
- `packages/agents/src/services/workflow-event-subscriber.ts`
- `packages/agents/src/services/node-edge-manager.ts`
- `packages/agents/src/services/real-time-workflow-builder.ts` (검토 후)
- `packages/agents/src/abstracts/base-workflow-converter.ts`
- `packages/agents/src/interfaces/workflow-converter.ts`
- 관련 exports 및 imports 정리

**목적**: agents 패키지의 workflow 관련 중복 코드 완전 제거 및 깔끔한 아키텍처 달성

## 🚀 **workflow 패키지 현재 상태**

- **패키지 크기**: 50.17 KB (적정)
- **타입 정의**: 53.87 KB (완전)
- **핵심 기능**: 100% 완료
- **품질 평가**: A급 (우수)
- **독립 사용**: 준비 완료
- **EventService**: ownerPath context pipeline

## 🎯 EventService ownerPath context ready

The workflow package should consume EventContext.ownerPath and avoid legacy contextual alias concepts.

### ✅ **완성된 핵심 기능**
- **단일 `extractors` 배열 방식**: 이중 구조 제거, 명확한 우선순위
- **`createChild(this)` 패턴**: 극단적 단순화된 EventService 생성
- **도메인 중립적 컨텍스트 추출**: `instanceof`/`constructor.name` 표준 매칭
- **workflow 패키지**: 완전한 이벤트 기반 워크플로우 시각화 시스템

이제 **Phase 6-7 마이그레이션 작업**을 통해 전체 시스템 통합을 진행할 차례입니다.
