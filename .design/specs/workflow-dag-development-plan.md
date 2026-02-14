---
title: "Workflow DAG 개발 계획"
description: "Airflow 운영모델을 참조한 Robota JS/TS DAG 시스템 개발 계획"
---

# Workflow DAG 개발 계획

## 1) 비전과 비-목표

### 비전
- Airflow를 **이식**하는 것이 아니라, 운영 모델을 참조해 Robota에 맞는 DAG 오케스트레이터를 구축한다.
- 브라우저(디자인/검증/시뮬레이션)와 서버(실행/스케줄/운영)를 분리하고, API 계약으로 약결합한다.

### 비-목표
- Python DAG/Operator/Hook 생태계 직접 호환
- Airflow와 1:1 기능 parity
- v1에서 분산 운영 기능 전체 제공

---

## 2) 최상위 원칙 (고정)

- **R1. Airflow 이식 금지**: 개념 참조만 허용, 구현은 JS/TS 네이티브로 설계
- **R2. v1 강제 축소**: 초기 기능은 최소 가치 흐름에 집중
- **R3. 기능 독립 구현**: runtime/worker/scheduler/projection/designer/api 분리
- **R4. 조립 레이어 분리**: 기능 조립/주입은 composition 계층에서만 수행
- **R5. API 약결합**: designer는 버전드 API 계약만 사용
- **R6. No-Fallback 준수**: 계약 위반은 즉시 실패, 우회 경로 금지

---

## 3) Airflow 참조 검증 요약

Airflow 공식 문서 기반 결론:
- DAG/DagRun/TaskInstance는 도메인 개념
- Scheduler/Executor/Worker/Queue는 실행 구현체 계층
- Worker는 선택적/확장 가능한 구성요소

적용 결론:
- `dag-core`는 개념/규칙/인터페이스만 포함
- runtime/worker/scheduler/projection은 구현체 계층으로 분리

검증 소스:
- https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/overview.html
- https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dag-run.html
- https://airflow.apache.org/docs/apache-airflow-providers-celery/stable/celery_executor.html

---

## 4) 패키지 분류 및 책임

### 4.1 패키지 목록 (확정)
- `@robota-sdk/dag-core`
- `@robota-sdk/dag-runtime`
- `@robota-sdk/dag-worker`
- `@robota-sdk/dag-scheduler`
- `@robota-sdk/dag-projection`
- `@robota-sdk/dag-api`
- `@robota-sdk/dag-designer`

### 4.2 패키지별 책임

#### `dag-core`
- 타입(Definition/Run/Task), validation, 상태머신, planning rule
- 포트 인터페이스:
  - `IQueuePort`, `ILeasePort`, `IStoragePort`, `ITaskExecutorPort`, `IClockPort`
- 구현체 코드(Queue SDK, worker loop, broker client) 금지

#### `dag-runtime`
- run orchestration, ready-task planning, dispatch use case
- 포트 기반 호출만 수행

#### `dag-worker`
- worker loop, lease heartbeat, retry/backoff, task execution runner

#### `dag-scheduler`
- cron/logical date 기반 run 생성
- catchup/backfill 계산

#### `dag-projection`
- event log 기반 run/task/lineage query model 구성

#### `dag-api`
- design/runtime/operations endpoint
- auth/validation/permission
- composition entry (wiring profile)

#### `dag-designer`
- DAG 편집/검증/publish UX
- API client 기반 동작
- 서버 capability 기반 기능 활성/비활성

### 4.3 의존 규칙 (강제)
- `dag-core`는 최하위 (역의존 없음)
- 다른 모든 패키지는 core만 공통 의존
- `dag-designer -> dag-runtime/worker/scheduler` 직접 의존 금지
- `dag-core -> infra SDK` 의존 금지
- lateral import/순환 의존 금지

### 4.4 구현체 클래스/인터페이스 명칭 초안

#### `dag-core` (도메인/계약)
- Interfaces:
  - `IDagDefinition`, `IDagNodeDefinition`, `IDagRun`, `ITaskRun`
  - `IQueuePort`, `ILeasePort`, `IStoragePort`, `ITaskExecutorPort`, `IClockPort`
  - `IRunPlanner`, `ITriggerRuleEvaluator`
- Classes:
  - `DagDefinitionValidator`
  - `DagDependencyResolver`
  - `TriggerRuleEvaluator`
  - `DagRunStateMachine`
  - `TaskRunStateMachine`
- Constants:
  - `DAG_RUN_STATUS`, `TASK_RUN_STATUS`
  - `DAG_EVENTS`, `RUNTIME_EVENTS`, `WORKER_EVENTS`

#### `dag-runtime` (오케스트레이션)
- Interfaces:
  - `IRunOrchestrator`, `ITaskDispatcher`, `ITaskPlanner`
- Classes:
  - `RunOrchestratorService`
  - `TaskPlannerService`
  - `TaskDispatcherService`
  - `RunCreationService`
  - `ReadyTaskSelectionService`

#### `dag-worker` (실행기)
- Interfaces:
  - `IWorkerLoop`, `ILeaseManager`, `IRetryPolicyEvaluator`
- Classes:
  - `WorkerLoopService`
  - `LeaseHeartbeatService`
  - `TaskExecutionRunner`
  - `RetryBackoffPolicy`
  - `DeadLetterService`

#### `dag-scheduler` (스케줄)
- Interfaces:
  - `IScheduleEvaluator`, `IBackfillPlanner`, `ICatchupPlanner`
- Classes:
  - `ScheduleEvaluatorService`
  - `CronScheduleCalculator`
  - `BackfillService`
  - `CatchupService`
  - `ScheduleTriggerService`

#### `dag-projection` (조회 모델)
- Interfaces:
  - `IRunProjection`, `ITaskProjection`, `ILineageProjection`
- Classes:
  - `RunProjectionService`
  - `TaskProjectionService`
  - `LineageProjectionService`
  - `ProjectionReplayService`
  - `ProjectionCheckpointService`

#### `dag-api` (조립/노출)
- Interfaces:
  - `IDesignApi`, `IRuntimeApi`, `IOperationsApi`
- Classes:
  - `DagDesignController`
  - `DagRuntimeController`
  - `DagOperationsController`
  - `DagApiCompositionRoot`
  - `CapabilityController`

#### `dag-designer` (웹)
- Interfaces:
  - `IDesignerApiClient`, `IDesignerCapability`
- Classes/Components:
  - `DagDesignerCanvas`
  - `NodePalettePanel`
  - `NodeConfigPanel`
  - `EdgeInspectorPanel`
  - `DesignerApiClient`
  - `CapabilityGuardService`

명명 규칙:
- 서비스 구현체는 `*Service` suffix
- 상태 전이 객체는 `*StateMachine`
- 조립 진입점은 `*CompositionRoot`
- 포트 인터페이스는 `I*Port` 형식 유지

### 4.5 구현체 간 관계 (요약)

#### 구현체별 한 줄 설명
- `RunOrchestratorService`: DAGRun의 전체 진행 상태를 제어하는 중앙 유스케이스
- `TaskPlannerService`: 현재 상태에서 실행 가능한 task 집합을 계산
- `TaskDispatcherService`: 계산된 task를 queue 포트로 전달
- `WorkerLoopService`: queue를 소비하며 task 실행 사이클을 반복
- `TaskExecutionRunner`: 단일 task의 실제 실행/결과 반영을 담당
- `LeaseHeartbeatService`: 실행 중 task lease를 갱신해 중복 실행을 방지
- `ScheduleEvaluatorService`: 스케줄 규칙을 평가해 run 생성 시점을 결정
- `BackfillService`/`CatchupService`: 과거 구간 run 생성 정책을 계산
- `RunProjectionService`/`TaskProjectionService`: event log를 조회용 모델로 변환
- `DagApiCompositionRoot`: 환경별 구현체를 조립해 API 계층에 주입
- `DesignerApiClient`: 디자이너에서 백엔드 API를 호출하는 단일 클라이언트

#### 호출/흐름 관계
1. `ScheduleEvaluatorService` 또는 API 수동 트리거가 DAGRun 생성을 요청
2. `RunOrchestratorService`가 run을 생성하고 `TaskPlannerService` 호출
3. `TaskDispatcherService`가 ready task를 queue로 전송
4. `WorkerLoopService`가 task를 수신하고 `TaskExecutionRunner` 실행
5. 실행 중 `LeaseHeartbeatService`가 lease를 유지, 실패 시 retry/DLQ 정책 적용
6. 실행 이벤트는 projection 계층(`RunProjectionService`, `TaskProjectionService`)에 반영
7. API는 projection을 조회해 상태를 제공, 디자이너는 `DesignerApiClient`로 조회/요청

#### 의존 방향(재확인)
- `runtime/worker/scheduler/projection/api/designer` -> `dag-core`
- `dag-designer`는 API 계약에만 의존하고 runtime/worker/scheduler 구현체에는 의존하지 않음

---

## 5) 조립 레이어 (Composition Layer)

### 목적
- 기능 패키지 독립성을 유지하면서 실제 실행 환경(dev/test/prod)을 조립

### 위치
- 1차: `dag-api` 내부 `composition` 모듈
- 2차(필요 시): `@robota-sdk/dag-composition`으로 분리

### 책임
- Queue/Storage/Executor/Clock 구현체 주입
- 환경 프로파일 관리
- health/readiness wiring

---

## 6) v1 범위 고정 (Scope Freeze)

### v1 포함
- DAG 정의 CRUD + validate + publish(version immutability)
- 수동 run trigger
- 단일 worker 실행
- run/task 상태 조회
- 기본 retry/timeout/lease

### v1 제외
- 분산 worker autoscaling
- backfill/catchup 자동화 운영
- DLQ 운영 UI
- 고급 scheduler timezone/DST 완전 대응
- 멀티테넌시 고급 정책

---

## 7) Gate 정의 (Pass/Fail 기준)

### Gate-1: Scope Gate (P0 종료 전)
의미:
- v1 포함/제외를 고정하여 개발 범위 변동을 차단

Pass:
- v1 포함/제외 목록 문서화 및 승인 완료
- 변경은 RFC 없이 불가

Fail:
- feature 요청 시 포함/제외 기준이 모호함
- 팀원이 다른 범위를 전제로 구현 시작

### Gate-2: Time Semantics Gate (P1 종료 전)
의미:
- 시간 모델(수동 실행 중심 + logicalDate 저장)을 테스트 가능한 규칙으로 고정

Pass:
- time policy 문서화(UTC 기준, v1 scheduler 제한)
- 관련 테스트 케이스 통과

Fail:
- timezone/DST 기준 미정
- 동일 입력에서 다른 scheduling 결과 발생

### Gate-3: Execution Guarantee Gate (P2 종료 전)
의미:
- 실행 보장 정책을 `at-least-once + idempotency`로 확정

Pass:
- `runKey/taskRunId` 멱등 처리 테스트 통과
- lease 만료 재할당 시 중복 부작용 없음

Fail:
- 중복 실행 방어 기준이 모호함
- retry/requeue 후 상태 불일치 발생

---

## 8) API 계약 및 약결합 전략

### 8.1 API 버전 전략
- 모든 외부 계약은 `/v1`로 시작
- breaking change는 `/v2`로 분리

### 8.2 필수 endpoint (v1)

#### Design API
- `POST /v1/dag-definitions`
- `PUT /v1/dag-definitions/:dagId/draft`
- `POST /v1/dag-definitions/:dagId/validate`
- `POST /v1/dag-definitions/:dagId/publish`

#### Runtime API
- `POST /v1/dag-runs`
- `GET /v1/dag-runs/:dagRunId`
- `GET /v1/dag-runs/:dagRunId/tasks`
- `POST /v1/dag-runs/:dagRunId/cancel`

#### Capability API
- `GET /v1/capabilities`
  - designer가 지원 기능을 동적으로 확인

### 8.3 Designer 약결합 규칙
- DB 직접 접근 금지
- runtime 내부 모듈 직접 import 금지
- projection API만 조회에 사용
- 미지원 기능은 UI에서 명시 비활성 처리

---

## 9) 데이터 모델 요약

### Design-time
- `DAGDefinition`
  - `dagId`, `version`, `status(draft|published|deprecated)`
  - `nodes`, `edges`, `inputSchema`, `outputSchema`

- `DAGNodeDefinition`
  - `nodeId`, `nodeType`, `config`
  - `dependsOn`, `triggerPolicy`, `retryPolicy`, `timeoutMs`

### Runtime
- `DAGRun`
  - `dagRunId`, `dagId`, `version`, `status`
  - `runKey`, `logicalDate`, `trigger`, `startedAt`, `endedAt`

- `TaskRun`
  - `taskRunId`, `dagRunId`, `nodeId`, `status`
  - `attempt`, `leaseOwner`, `leaseUntil`
  - `inputSnapshot`, `outputSnapshot`, `error`

---

## 10) 실행 흐름 (v1)

1. API가 DAG definition version 기준 `DAGRun` 생성
2. runtime이 entry node `TaskRun(ready)` 생성
3. queue dispatch
4. worker가 lease 획득 후 실행
5. 결과 저장 + event 발행
6. runtime이 다음 ready task 계산
7. terminal 집계 후 DAGRun 종료

---

## 11) 개발 로드맵 (P0~P4)

### P0 기반 계약/스캐폴딩
- `dag-*` 패키지 생성
- core 타입/상수/포트/상태머신 구현
- 의존 규칙/순환 금지 검증

### P1 Design-time MVP
- definition CRUD + validate + publish
- designer validate/publish 연동
- Gate-2 통과 준비

### P2 Runtime MVP
- run orchestration + worker 실행 + retry/lease
- runtime API 조회/취소
- Gate-3 통과

### P3 Scheduler/확장
- scheduler 기본 도입
- backfill/catchup(제한 범위)
- DLQ 운영 경로

### P4 운영/관측성
- projection 대시보드
- lineage/bottleneck 분석
- 운영 진단/알림 도구

---

## 12) 테스트 전략

### 단위
- validator, transition guard, planning rule, retry/backoff

### 통합
- API -> runtime -> worker -> projection
- scheduler -> runtime -> worker

### E2E
- designer: create -> validate -> publish -> trigger run
- run/task 조회/취소/재시도

### 회귀
- 동일 definition + 동일 input = 동일 output

---

## 13) 리스크와 완화

- 상태 불일치:
  - lease + transition guard + projection consistency check
- 중복 실행:
  - runKey/taskRunId 멱등 강제
- 범위 팽창:
  - Gate-1 범위 고정 + RFC 변경 프로세스
- 성능 저하:
  - projection 분리 + hot-path 인덱스

---

## 14) 기존 `workflow` 전환 전략

- Step 1: 기존 `workflow` 동결(유지)
- Step 2: 신규 기능은 `dag-*`에서만 개발
- Step 3: feature flag로 workflow/dag 병행 검증
- Step 4: 안정화 후 기본 엔진을 dag로 전환
- Step 5: workflow는 read-only 호환 레이어로 축소

---

## 15) 즉시 다음 액션

1. Gate-1 문서 승인 (v1 포함/제외 확정)
2. P0 스캐폴딩 착수
3. core 포트 인터페이스 + 상태머신 우선 구현
4. mock queue/storage로 P2 전 단계 E2E 준비

