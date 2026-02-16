---
title: "완료 작업 기록"
description: "CURRENT-TASKS에서 완료 처리된 항목을 보관한다"
---

# 완료 작업 기록
> 이 문서의 완료 항목은 스킬/룰/README/spec/future 문서로 흡수되었다.

## 2026-02-07

### Priority 0.7: Type Ownership Audit (SSOT) + Prefix Rollout
- StructuredEventService owner prefix 합성 emit 적용
- local event name 검증(`.` 포함 시 오류)
- 사용자/태스크 이벤트 호출부 local name 전환
- Event name ownership 단일화(Batch E)
- Type ownership audit 인벤토리 작성
- Batch A-D(로컬 유니온 제거/계약 단일화) 확인 완료

### Event Log SSOT + 실시간 투영
- Event Log 저장소/스키마 확정
- 로그 입력 경로 단일화(수신 → Log append)
- Incremental Projection 구현(Workflow/History)
- 스냅샷/체크포인트 규칙 구현
- WorkflowEventSubscriber 역할 축소
- 리플레이 모드 구현(시작 시퀀스는 호출자 결정)

### Event Log 구현(개발 단계) 완료
- Step 1~10 완료(스키마, store, snapshot, projections, replay, tests)

### History Module 분리 구현 완료
- Step 1~5 완료(인터페이스, store, listener 연결, 투영 연결)

### Event 시스템 실행 계획(부분 완료)
- 중앙 매칭 단일화(`eventName -> handler` 단일 매칭)
- 핸들러 클래스/팩토리 계층 제거

### Event 시스템 실행 계획(잔여 작업) 완료
- [E-01] 이벤트 단위 최소 기록 정책 확정
- [E-02] 정렬 기준 `ownerPath → timestamp → eventType/sequence` 확정
- [E-03] 오류 처리 단일화(핸들러 내부 try/catch 제거)
- [E-04] 결과 구조 최소화(`success/updates/errors`)
- [E-05] Bridge/Adapter 네이밍 정리(`workflow-event-service-bridge`)
- [E-06] 단일 기본 핸들러 레지스트리 구성
- [E-08] `metadata`/`processed` 플래그 최소화

### Projection/Scenario 계획 완료
- [P-01] Projection 캐시 설계/인터페이스/초기 구현/테스트 완료
- [S-01] 시나리오 도메인 분리 완료
- [S-02] Play 모드 tool 결과 재생 정책 고정 완료
- [S-03] 단일 CLI 진입점 통합(record/play/verify) 완료
- [S-04] 병렬 tool call 기본 전략 `hash` 통일 완료
- [S-05] guarded 시나리오 검증 명령 템플릿/재녹화/검증 완료

### 이벤트 시스템 점검 기반 개선 작업 완료
- [R-01] EventEmitterPlugin 에러 재귀 차단 완료
- [R-02] WorkflowEventServiceBridge 비동기 오류 전파 정책 정리 완료
- [R-03] 이벤트 핵심 모듈 단위 테스트 추가 완료
- [R-04] EventEmitterPlugin `getStats()` 실제 카운팅 반영 완료

## 2026-02-08

### Workflow 규칙 정합화 (P0~P2 Phase A) 완료
- [P0] `agent-event-handler` dedup/silent-success 제거 완료
- [P0] `workflow-event-service-bridge` 즉시 실패 전파 + 실패 후 emit 차단 테스트 추가 완료
- [P0] `toolTypeMap` 제거로 handler neutrality 정리 완료
- [P1] 금지 용어(`parentAgentId`/`childAgentId`)를 `delegating/delegated`로 정리 완료
- [P1] projection cache 이벤트 prefix 하드코딩 제거(agents 상수 기반) 완료
- [P1] 미사용 보조 상태/데드코드(`workflow-state`, `workflow-state-access`) 제거 완료
- [P2-1] `tool_response_call_*` 네이밍 추론 제거 완료 (ownerPath + 기존 노드 explicit data 스캔 방식)
- [P2-2 Phase A] event record 변환 단일 어댑터화 완료
  - `event-record-adapter.ts` 신설
  - `workflow-projection`의 변환 로직 분산 제거
- [P2] playground 타입 용어 정합성(`delegatingAgentId`) 반영 완료

### 규칙/스킬 정렬 강화 완료
- `EMITTER-CONTRACT` / `APPLY-LAYER` 실패 분류 규칙 반영
- `Node/Edge Creation Contract` 용어 및 금지 규칙(메타 필드로 링크 결정 금지) 반영
- Decision Gate Protocol(중요 선택 시 사용자 선택 후 진행) 스킬 반영

### 검증 완료
- `@robota-sdk/workflow` 테스트/빌드 통과
- `@robota-sdk/playground` 빌드 통과
- workflow scenario verify 템플릿(`guarded`/`continued`) 통과
- rules/skills 충돌 스캔 재실행 완료

### P2-2 Phase B (조기 착수/완료) - Event Record SSOT 통합
- 사용자 지시로 Phase B 즉시 착수 후 완료
- `TEventLogRecord`를 `IEventHistoryRecord` 기반 단일 축으로 통합
- workflow event-log/store/projection 계약을 `eventData + context.ownerPath + sequenceId` 기준으로 정렬
- `event-record-adapter`를 record 변환이 아닌 `TEventData` 정규화(no-op 성격)로 축소
- 검증:
  - `pnpm --filter @robota-sdk/workflow test` 통과
  - `pnpm --filter @robota-sdk/workflow build` 통과
  - `pnpm --filter @robota-sdk/agents build` 통과
  - `pnpm --filter @robota-sdk/playground build` 통과

### 규칙 완전 준수 루프 추가 완료 (playground + workflow)
- `playground` P1 Batch-1b/1c/1d 완료:
  - `workflow-visualization.tsx`, `playground-context.tsx`, `execution-subscriber`, `tool-container-block`, `template-gallery`, `WorkflowView`, `PlaygroundApp` 타입 정리 및 `any/as any` 제거
- `playground` P1 Batch-2a/2b/2c/2d/2e 완료:
  - `workflow-visualization`, `real-time-tool-block`, `block-node`, `plugin-container-block`, `block-visualization-panel`, `block-tree`, `tool-container-block`, `ui/progress`, `ui/sonner`의 inline style 제거(Tailwind-only 정합)
- `workflow` 예제 검증 유틸 logger DI 전환 완료:
  - `packages/workflow/examples/utils/verify-workflow-connections.ts`
  - 검증 출력 경로를 주입형 logger로 통일

### 규칙 준수 루프 재감사 배치 완료 (추가 타입 단층 정리)
- `agents`:
  - `packages/agents/src/plugins/limits-plugin.ts`
    - 모델명/실행키 추출에서 blind assertion 제거 (`as string` 제거)
  - `packages/agents/src/utils/execution-proxy.ts`
    - `Proxy` 메서드명 처리에서 `prop as string` 제거, string key 가드로 단일 경로화
  - `packages/agents/src/managers/module-type-registry.ts`
    - category 로깅 assertion 제거
  - `packages/agents/src/managers/agent-templates.ts`
    - 통계 집계(`categories/providers/models`)에 타입 가드 적용, assertion 제거
- `workflow`:
  - `packages/workflow/src/handlers/builders/agent-node-builder.ts`
    - tools 추출 시 string 필터 기반으로 타입 축소
  - `packages/workflow/src/handlers/builders/execution-node-builder.ts`
    - `parameters` 접근 공통 헬퍼(`getStringParam`)로 통합, 다중 assertion 제거
- `playground`:
  - `packages/playground/src/lib/playground/remote-injection.ts`
    - sandbox execute 반환형/console 인자 타입 정리, `any/as any` 제거
  - `packages/playground/src/lib/playground/code-executor.ts`
    - compiled code 생성부 `any` 제거
  - `packages/playground/src/components/playground/workflow-visualization.tsx`
    - tools 배열 처리 헬퍼 도입, 일부 string assertion 제거
- 빌드 검증:
  - `pnpm --filter @robota-sdk/agents build` 통과
  - `pnpm --filter @robota-sdk/workflow build` 통과
  - `pnpm --filter @robota-sdk/playground build` 통과

### P2 추가 배치 완료 - workflow-visualization 타입 경계 정리
- `packages/playground/src/components/playground/workflow-visualization.tsx`
  - 명시적 데이터 타입 계층 추가:
    - `IWorkflowVisualizationParameters`
    - `IWorkflowVisualizationResultData`
    - `IWorkflowVisualizationModelInfo`
    - `IWorkflowVisualizationMetadata`
  - `sourcePosition`/`targetPosition`를 노드 데이터 명시 필드로 선언하여 Handle 위치 타입 불일치 제거
  - 문자열 렌더링 경로를 `toText()` 헬퍼로 단일화해 union 직접 접근 제거
  - `NodeChange<TWorkflowVisualizationNode>` 적용으로 노드 변경 이벤트 제네릭 경계 정렬
- `packages/playground/src/lib/workflow-visualization/react-flow/progressive-reveal-wrapper.ts`
  - Hook 제네릭화(`TNode extends Node`, `TEdge extends Edge`)로 호출부 데이터 축 유지
- `packages/playground/src/lib/workflow-visualization/auto-layout.ts`
  - `applyDagreLayout`/`layoutExistingFlow` 제네릭화로 레이아웃 후 노드 타입 보존
- 재검증 루프:
  - 코드 스캔: `any/as any`, inline style, 하드코딩 이벤트명, 금지 용어 재확인
  - 빌드: `@robota-sdk/agents`, `@robota-sdk/workflow`, `@robota-sdk/playground` 통과
  - `ReadLints` 기준: 실제 코드 오류 없음
    - 참고: `@robota-sdk/agents` declaration 파일 미탐지 IDE 진단 1건은 기존 환경성 진단으로 유지

## 2026-02-14

### DAG 구현/검증/구조개선 완료
- Gate-1/2/3 기준 포함한 DAG v1 범위(P0-pre~P4) 전체 구현 완료
- `dag-core/runtime/worker/scheduler/projection/api/designer` 패키지 스캐폴딩 및 핵심 기능 구현 완료
- no-fallback 강화:
  - fail-fast 기본값(`retryEnabled=false`) 고정
  - diagnostics reinject 정책 게이트(`reinjectEnabled=false` default) 적용
  - rerunKey 기반 rerun identity 분리 적용
- Critical 보완 완료:
  - downstream dispatch 구현
  - DLQ reinject 시 상태 복구 전이 반영
  - terminal 재활성화 차단 E2E 검증
- Complexity 축소(Phase 1) 완료:
  - 에러 빌더 공통화
  - ProblemDetails/API contracts 공통화
  - `replaceAttemptSegment` 유틸 공통화
  - `queuedTaskRunIds` -> `taskRunIds` 정합성 반영
- 구조 단순화(Phase 2) 완료:
  - controller 내부 service 생성 제거 + composition DI 일원화
  - `WorkerLoopService.processOnce` 경로 분해(success/failure/retry/finalize)
  - observability dashboard 중복 조회 제거(`buildDashboardProjection` 도입)
- 검증:
  - 관련 DAG 패키지 빌드/테스트 전체 통과
  - 변경 파일 lint 에러 없음

## 2026-02-15

### DAG 로컬 실행/문서화 트랙 완료 (P-Doc)
- P-Doc-0 완료:
  - 실행 진입점 `apps/api-server` 확정
  - 웹 host 전략 `apps/web` 확장 확정
  - no-fallback/실패 처리 고정 문구 확정
- P-Doc-1 완료:
  - `apps/api-server` DAG dev 엔트리(`dag:dev`, `dag:start`) 구현
  - `apps/web` `/dag-designer` host 경로 및 `DesignerApiClient` 연동 구현
  - 환경변수 요구사항 정리:
    - `apps/api-server/.env.example` (`DAG_DEV_PORT`)
    - `apps/web/.env.dag.example`
- P-Doc-2 완료:
  - build/test/dev/start 표준 명령표 확정
  - 실검증 및 로그 문서화 완료
  - `pnpm --filter '@robota-sdk/dag-*' test` 간헐 실패 이슈를 순차 실행 표준으로 정리
- P-Doc-3 완료:
  - 사용자 가이드 초안 작성
  - 문서 단독 재현 라운드 수행(Browser MCP 포함)
  - 증거 링크 정리 및 완료 선언
- Gate-Doc:
  - Gate-Doc-1/2/3/4 전체 통과

### 문서 산출물
- `apps/api-server/docs/SPEC.md`
- `apps/web/docs/SPEC.md`
- `packages/dag-core/docs/SPEC.md` (DAG 계층 스펙 분산 기준)

### DAG Designer 조합형/훅 API/오버레이 레이아웃 정리 완료
- 조합형 컴포넌트 확장 완료:
  - `DagDesigner.Root/Canvas/NodeExplorer/Inspector`
  - 세부 분리 컴포넌트 `DagDesigner.NodeConfig`, `DagDesigner.EdgeInspector` 추가
- Node Explorer UI 개선 완료:
  - 카테고리 탭(Tabs) 기반 탐색으로 전환
- 훅 API 계층 추가 완료:
  - `useDagDesignerState`, `useDagDesignerActions`
  - `useDagDesignApi`(create/update/validate/publish/load/list/catalog)
- web host 연동 정리 완료:
  - `apps/web`에서 `DesignerApiClient` 직접 호출 제거
  - 훅 기반 액션 호출로 전환
- 레이아웃 정리 완료:
  - 캔버스 풀 스크린 + 상단 컴팩트 헤더
  - 좌/우 패널 플로팅 토글
  - controls 오버레이(공간 비점유) 전환
  - 우측 `Node Config` + `Edge Inspector`를 단일 레이아웃 컨테이너로 정리
- 검증:
  - `pnpm --filter @robota-sdk/dag-designer build` 통과
  - `pnpm --filter @robota-sdk/web build` 통과
  - `/dag-designer` 스모크(Create/Validate/Publish/Preview) 확인

### DAG 노드 패키지 분리 마이그레이션 완료 (dag-nodes)
- 노드 패키지 구조 전환 완료:
  - 물리 경로: `packages/dag-nodes/<slug>`
  - 패키지명: `@robota-sdk/dag-node-<slug>`
- 초기 분리 패키지 완료:
  - `dag-node-input`, `dag-node-transform`, `dag-node-llm-text`
  - `dag-node-image-loader`, `dag-node-image-source`, `dag-node-ok-emitter`
- 하드 컷오버 완료:
  - `dag-core` 기본 노드 내장 manifest/handler 생성 경로 제거
  - `apps/api-server`가 `@robota-sdk/dag-node-*` 직접 import로 bootstrap 조합
  - `dag-designer` preview도 동일 노드 패키지 조합 경로로 전환
- 검증:
  - `pnpm --filter \"@robota-sdk/dag-node-*\" build` 통과
  - `pnpm --filter @robota-sdk/dag-core build` 통과
  - `pnpm --filter @robota-sdk/dag-designer build` 통과
  - `pnpm --filter @robota-sdk/dag-api build` 통과
  - `pnpm --filter @robota-sdk/api-server build` 통과
  - `GET /v1/dag/nodes` 노드 목록 응답 확인
  - bootstrap/run/process-once 스모크 확인

### DAG Node Definition 책임 정렬 완료 (SSOT)
- `IDagNodeDefinition`을 노드 타입 원본 계약으로 고정:
  - `nodeType`, `displayName`, `category`
  - `inputs`, `outputs`
  - `configSchemaDefinition`
  - `taskHandler`
- 노드 패키지에서 `buildManifest()` 제거:
  - `packages/dag-nodes/input`
  - `packages/dag-nodes/transform`
  - `packages/dag-nodes/llm-text`
  - `packages/dag-nodes/image-loader`
  - `packages/dag-nodes/image-source`
  - `packages/dag-nodes/ok-emitter`
- 중앙 조립부 단일화:
  - `buildNodeDefinitionAssembly()`에서만 `configSchemaDefinition -> configSchema(JSON Schema) -> INodeManifest` 파생
- 문서 정합성 반영:
  - `dag-local-node-store-spec.md`에 `IDagNodeDefinition` 인스턴스 + 중앙 assembly 규칙 명시
  - DAG 계층 분산 스펙(`packages/dag-*/docs/SPEC.md`, `apps/*/docs/SPEC.md`) 기준으로 완료/비정합 계획 정리
- 검증:
  - `pnpm --filter @robota-sdk/dag-core build` 통과
  - `pnpm --filter \"@robota-sdk/dag-node-*\" build` 통과
  - `pnpm --filter @robota-sdk/dag-designer build` 통과
  - `pnpm --filter @robota-sdk/api-server build` 통과
  - `GET /v1/dag/nodes` 스모크 통과

## 2026-02-16

### DAG Designer Preview 경로 정합화 완료
- `Run Preview`의 LLM 호출 경로를 로컬 mock(`preview:*`)에서 API 서버 기반 실제 LLM completion 경로로 전환 완료
- API 서버에 preview 전용 엔드포인트 추가:
  - `POST /v1/dag/dev/llm-text/complete`
- 디자이너 프리뷰 엔진에 원격 LLM 클라이언트 주입 경로 추가:
  - `createRemoteLlmCompletionClient`
  - `runDefinitionPreview(..., options.llmCompletionClient)`
- `text-output` 노드가 입력 텍스트를 최종 출력으로 명시 반환하도록 정리 완료
- `/dag-designer`의 `Latest Result` 로그에 `latestLlmOutput` 표시 추가 완료
- 검증:
  - `pnpm --filter @robota-sdk/dag-designer build` 통과
  - `pnpm --filter @robota-sdk/api-server build` 통과
  - `pnpm --filter @robota-sdk/web build` 통과
  - preview LLM endpoint 실호출 및 completion 응답 확인
