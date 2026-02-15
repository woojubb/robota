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

정책(고정):
- 모든 저장 시간은 UTC ISO-8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`) 형식으로 정규화한다.
- v1에서 scheduler 트리거는 `logicalDate`를 필수로 제공해야 한다.
- v1에서 manual/api 트리거는 `logicalDate`가 없으면 `requestedAt(현재 UTC)`를 `logicalDate`로 사용한다.
- timezone/DST 해석은 입력 시점에 UTC로 정규화하여 저장하고, 저장 후에는 UTC 기준만 사용한다.

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
- `POST /v1/dag/definitions`
- `PUT /v1/dag/definitions/:dagId/draft`
- `POST /v1/dag/definitions/:dagId/validate`
- `POST /v1/dag/definitions/:dagId/publish`

#### Runtime API
- `POST /v1/dag/runs`
- `GET /v1/dag/runs/:dagRunId`
- `GET /v1/dag/runs/:dagRunId/tasks`
- `POST /v1/dag/runs/:dagRunId/cancel`

#### Capability API
- `GET /v1/dag/capabilities`
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

## 15) 규칙 준수 검토 결과 및 보완 항목

P0 착수 전 기존 rules/skills 전체와 교차 검토한 결과.
각 항목은 해당 규칙 참조와 함께 결정 사항/미결 사항을 명시한다.

### 15.1 DAG 이벤트 계층 분리 및 안전장치 3개 (심각도: 높음)

규칙 참조: `workflow-event-rules.mdc` — Event Ownership by Prefix

#### 문제 재정의
기존 workflow 이벤트와 DAG 이벤트는 같은 목적의 이벤트가 아니다.
- 기존 workflow 이벤트: agent/tool/team 실행 흐름 추적
- DAG 이벤트: DAGRun/TaskRun/Worker/Scheduler 도메인 상태 전이

즉, 두 이벤트 시스템은 **호환 대상이 아니라 서로 다른 계층**이다.

#### 결정 사항
- v1에서 DAG 이벤트 시스템은 기존 workflow 이벤트 시스템과 **완전 분리**한다.
- 따라서 DAG 이벤트 이름은 `dag-*` 접두어 강제를 기본 전제로 두지 않는다.
- DAG 이벤트 네임스페이스는 도메인 의미를 직접 반영한다:
  - `run.*` — DAGRun 생명주기 이벤트
  - `task.*` — TaskRun 생명주기 이벤트
  - `worker.*` — Worker 실행 이벤트
  - `scheduler.*` — Scheduler 트리거 이벤트
- `dag-core`에 이벤트 상수 정의:
  ```
  RUN_EVENTS = { CREATED, RUNNING, SUCCESS, FAILED, CANCELLED } as const
  TASK_EVENTS = { QUEUED, RUNNING, SUCCESS, FAILED, UPSTREAM_FAILED, SKIPPED } as const
  WORKER_EVENTS = { LEASE_ACQUIRED, HEARTBEAT, LEASE_EXPIRED, EXECUTION_COMPLETE } as const
  SCHEDULER_EVENTS = { EVALUATED, TRIGGERED, SKIPPED } as const
  ```

#### 안전장치 3개 (강제)
1. **이벤트 버스 분리 고정**
   - DAG는 DAG 전용 EventService/Emitter 인스턴스를 사용한다.
   - 기존 workflow/agent/team 이벤트 버스와 shared instance를 금지한다.

2. **경계 브리지 기본 금지**
   - v1에서 DAG 이벤트를 workflow 이벤트로 변환/브리지하는 모듈을 두지 않는다.
   - 브리지가 필요해지면 v2에서 별도 ADR로 승인 후 추가한다.

3. **교차 import 금지 + 검증**
   - `dag-*` 패키지는 workflow 이벤트 상수(`EXECUTION_EVENTS`, `TOOL_EVENTS`, `AGENT_EVENTS`)를 import하지 않는다.
   - workflow 패키지도 DAG 이벤트 상수를 import하지 않는다.
   - CI 스캔으로 교차 import가 발견되면 실패 처리한다.

### 15.2 v1 어댑터(구현체) 스펙 (심각도: 높음)

규칙 참조: `hexagonal-architecture-ts` SKILL — "Composition root wires ports to adapters"

#### 문제
포트 인터페이스는 정의되었으나 v1에서 실제 사용할 어댑터가 미정.

#### 결정 사항 (v1 어댑터)
- **원칙**: 모든 Adapter의 기술 스택을 사전 고정하지 않는다.
- **예외**: 필수 Adapter에 한해서만 기술/구현 전략을 사전 확정한다.

#### 필수 Adapter 사전 확정 항목
| 포트 | 사전 확정 내용 | 이유 |
|------|----------------|------|
| `IStoragePort` | v1 기본 구현을 `SQLiteStorageAdapter`로 고정 | 상태 일관성/트랜잭션/재현 가능한 테스트 확보 |
| `IClockPort` | `SystemClockAdapter` + 테스트용 `FakeClock` 제공 | 시간 결정론(Time semantics, lease/retry 테스트) 확보 |

#### 비필수 Adapter (기술 스택 미고정)
| 포트 | v1 요구사항(계약) | 구현 선택 시점 |
|------|------------------|----------------|
| `IQueuePort` | enqueue/dequeue/ack 기본 계약 충족 | P0 구현 시 선택 |
| `ILeasePort` | acquire/renew/release 및 만료 규칙 충족 | P0 구현 시 선택 |
| `ITaskExecutorPort` | task 입력/출력/에러 계약 충족 | P0 구현 시 선택 |

- 모든 v1 어댑터는 `dag-api` composition 모듈에서 주입
- 어댑터 구현체 위치: 각 구현 패키지 내부 또는 `dag-api/adapters/`
- 테스트용 mock 어댑터: `dag-core/testing/` 모듈로 제공
- P0 완료 조건: 비필수 Adapter는 기술 선택 자체보다 **포트 계약 준수 테스트 통과**를 우선한다

### 15.3 에러 분류 체계 (심각도: 높음)

규칙 참조: `execution-safety-rules.mdc` — Failure Layer Classification

#### 문제
기존 `[EMITTER-CONTRACT]`/`[APPLY-LAYER]` 분류는 workflow 전용.
DAG 시스템은 더 많은 실패 지점이 있으나, 외부 API/내부 처리/재시도 정책을 함께 다루는 표준 에러 구조가 없다.

#### 결정 사항 — 표준형 에러 모델
- 내부 에러는 **code-first typed error**로 통일한다.
- 외부 API 응답은 **RFC 7807 Problem Details** 형식으로 통일한다.
- 레이어 태그는 category(분류)로 유지하되, 분기 기준은 `code`와 `retryable`을 우선한다.

#### 내부 에러 모델 (code-first)
```ts
type TErrorCategory =
  | 'validation'
  | 'state_transition'
  | 'lease'
  | 'dispatch'
  | 'task_execution';

interface IDagError {
  code: string;
  category: TErrorCategory;
  message: string;
  retryable: boolean;
  context?: Record<string, string | number | boolean>;
}
```

#### 카테고리/코드/정책
| 카테고리 | 대표 코드 예시 | retryable | 정책 |
|----------|----------------|-----------|------|
| `validation` | `DAG_VALIDATION_INVALID_SCHEMA` | `false` | 즉시 reject, run 생성 불가 |
| `state_transition` | `DAG_STATE_TRANSITION_INVALID` | `false` | 즉시 중단 |
| `lease` | `DAG_LEASE_CONTRACT_VIOLATION` | `false` | 즉시 중단 |
| `dispatch` | `DAG_DISPATCH_UNAVAILABLE` | `true` | 재시도 정책 범위 내 재시도 |
| `task_execution` | `DAG_TASK_EXECUTION_FAILED` | `true` | retry 정책 적용 후 terminal |

#### 외부 API 에러 모델 (RFC 7807)
```json
{
  "type": "https://robota.dev/problems/dag/state-transition",
  "title": "Invalid state transition",
  "status": 409,
  "detail": "TaskRun cannot transition from running to queued.",
  "instance": "/v1/dag/runs/run_123/tasks/task_9",
  "code": "DAG_STATE_TRANSITION_INVALID",
  "retryable": false,
  "correlationId": "req-9f2c"
}
```

#### API 매핑 기준 (v1)
| category | HTTP status 기본값 |
|----------|--------------------|
| `validation` | `400` |
| `state_transition` | `409` |
| `lease` | `409` |
| `dispatch` | `503` |
| `task_execution` | `500` |

- `Result<T, E>` 패턴 적용: 도메인 함수는 throw 대신 typed result 반환
  - `effect-style-error-modeling` SKILL 적용
  - 경계 어댑터에서만 외부 예외를 도메인 에러로 변환
- 모든 실패 로그/메트릭은 최소한 `code`, `category`, `retryable`를 포함한다.

### 15.4 상태 머신 순수성 (심각도: 중간)

규칙 참조: `functional-core-imperative-shell` SKILL

#### 문제
`DagRunStateMachine`, `TaskRunStateMachine`의 구현 방식이 미명시.

#### 결정 사항
- 상태 머신은 **순수 함수**로 구현:
  ```
  (currentStatus, event) → { newStatus } | { error: TTransitionError }
  ```
- side-effect(DB 저장, 이벤트 발행)는 호출자(orchestrator/runner)가 수행
- 상태 머신 내부에 logger, storage, clock 의존 금지
- `dag-core`의 상태 머신은 브라우저에서도 실행 가능해야 함 (designer validation 용)

### 15.5 로거 DI 정책 (심각도: 중간)

규칙 참조: `development-architecture-rules.mdc` — "NEVER use console.* directly"

#### 결정 사항
- 모든 DAG 서비스 클래스에 로거 DI 적용:
  ```
  constructor(private readonly logger: SimpleLogger = SilentLogger)
  ```
- `dag-core` 포트/상태머신/validator: 로거 불필요 (순수 함수)
- `dag-runtime/worker/scheduler/projection/api`: 로거 DI 필수
- `dag-designer`: 브라우저 환경에 맞는 로거 인터페이스 (동일 `SimpleLogger` 계약)

### 15.6 기존 Agent/Task 통합 포인트 (심각도: 중간)

규칙 참조: `agent-identity-rules.mdc`, `development-architecture-rules.mdc`

#### 문제
DAG Task의 handler로 Robota Agent를 사용할 수 있는지 미정.

#### 결정 사항
- `ITaskExecutorPort`의 v1 구현은 plain JS 함수 실행만 지원
- Agent 통합은 v1 범위 제외 (v2+ 후보)
  - v2 후보: `AgentTaskExecutor` 어댑터가 `ITaskExecutorPort`를 구현
- `dependsOn`은 data dependency이며 agent hierarchy와 무관함을 명문화
  - `dependsOn`은 DAG 설계 시 정의하는 "이 노드는 저 노드의 출력이 필요"라는 의미
  - agent-identity 규칙의 hierarchy 금지와 충돌하지 않음

### 15.7 브라우저/Node 호환성 경계 (심각도: 중간)

규칙 참조: `project-structure-rules.mdc`

#### 문제
`dag-core`는 designer(브라우저)와 worker(Node) 양쪽에서 사용되나 호환 경계 미상세.

#### 결정 사항
- `dag-core` 금지 API:
  - `fs`, `path`, `child_process`, `worker_threads`, `net`, `os` 등 Node-only 모듈
  - `process.env` 직접 참조 (환경 설정은 composition 레이어에서 주입)
- `dag-core` tsconfig 제약:
  - `lib: ["ES2022"]` (DOM 미포함)
  - Node 전용 `@types/node` 미포함
- 런타임 분류:
  - **브라우저 실행 가능**: `dag-core`, `dag-designer`
  - **Node 전용**: `dag-runtime`, `dag-worker`, `dag-scheduler`, `dag-projection`, `dag-api`
- `IClockPort`로 시간 추상화: `Date.now()` 직접 사용 금지 (순수성 + 테스트 용이성)

### 15.8 이벤트 스키마 버전 관리 (심각도: 중간)

규칙 참조: `cqrs-event-projection-basics` SKILL — "Event schemas are explicit and version-aware"

#### 결정 사항
- 모든 DAG 이벤트에 `schemaVersion: number` 필드 포함
- v1에서는 `schemaVersion: 1` 고정, 하지만 필드 자체는 처음부터 포함
- projection handler에서 `schemaVersion` 체크 로직 포함:
  - 알려진 버전만 처리, 미지원 버전은 `[DAG-VALIDATION]` 에러
- 향후 schema migration은 projection replay 시 version-aware transformer로 처리
  - v1에서는 구현하지 않되, 확장 포인트만 확보

### 15.9 실행 추적 경로 (ownerPath 대응물) (심각도: 중간)

규칙 참조: `workflow-event-rules.mdc` — OwnerPath Inheritance Intent

#### 문제
기존 workflow는 `ownerPath`로 계보 추적. DAG에는 이에 대응하는 개념이 미정.

#### 결정 사항
- DAG 실행 추적 경로: `executionPath` 배열
  - 형식: `[dagId, dagRunId, nodeId, taskRunId, attempt]`
  - 모든 이벤트 payload에 `executionPath` 필수 포함
- 용도:
  - projection에서 lineage 구성
  - 로그 상관관계(correlation) 추적
  - 에러 메시지의 컨텍스트 정보
- 관계 결정은 `executionPath`와 명시적 계약 필드만 사용
  - ID 파싱/regex 추론 금지 (기존 path-only 규칙 준수)

### 15.10 테스트 인프라 구체화 (심각도: 낮음)

규칙 참조: `vitest-testing-strategy` SKILL

#### 결정 사항
- 테스트 프레임워크: Vitest (기존 프로젝트와 동일)
- 파일 컨벤션: `*.test.ts` (`__tests__/` 디렉터리 또는 소스 옆 배치, P0에서 확정)
- mock 어댑터:
  - `dag-core/src/testing/` 모듈에서 mock 어댑터 export
  - `InMemoryQueuePort`, `InMemoryStoragePort`, `FakeClock` 등
  - 다른 패키지의 통합 테스트에서 import해 사용
- Vitest workspace: 기존 `vitest.workspace.ts`에 `dag-*` 패키지 추가
- 테스트 분류:
  - 단위: 상태 머신, validator, planning rule (순수 함수 table-driven)
  - 통합: 어댑터 + 서비스 wiring
  - E2E: composition root → full flow

### 15.11 pnpm workspace / 빌드 통합 (심각도: 낮음)

규칙 참조: `project-structure-rules.mdc`, `build-and-resolution-rules.mdc`

#### 결정 사항
- `pnpm-workspace.yaml`에 `packages/dag-*` 추가 (P0 첫 작업)
- `tsconfig` 구조:
  - 각 패키지는 `tsconfig.base.json` 상속
  - `dag-core`는 `lib: ["ES2022"]` (브라우저 호환)
  - Node 전용 패키지는 `@types/node` 포함
- 빌드 순서 (dependency chain):
  1. `dag-core` (최우선)
  2. `dag-runtime`, `dag-worker`, `dag-scheduler`, `dag-projection` (core 의존)
  3. `dag-api` (runtime/worker/scheduler/projection 의존)
  4. `dag-designer` (core + API client만 의존)
- `project-structure-rules.mdc` 패키지 목록은 P0 완료 후 업데이트

### 15.12 Rules/Skills 문서 업데이트 범위 (심각도: 낮음)

규칙 참조: `skills-link-rules.mdc` — Rule/Skill-to-Spec Mapping

#### 결정 사항
- P0 완료 시점에 업데이트할 문서:
  - `project-structure-rules.mdc`: 패키지 목록에 `dag-*` 추가
  - `workflow-event-rules.mdc`: DAG 이벤트 프리픽스 섹션 추가
  - `skills-link-rules.mdc`: DAG 도메인 섹션 추가
- DAG 전용 skill 후보 (필요 시 생성):
  - `dag-state-machine-guidance`: 상태 전이 설계 가이드
  - `dag-port-adapter-guide`: 포트/어댑터 구현 가이드
- 신규 skill은 실제 구현 경험 후 구체화 (P1~P2 시점)

---

## 16) 현재 상태 요약

- DAG v1 구현 범위(P0-pre~P4), Critical 보완, Complexity 축소(Phase 1), 구조 단순화(Phase 2)까지 완료
- no-fallback/terminal failure 정책 게이트 및 E2E 검증 반영 완료
- 현재 남은 주 작업은 **사용자용 실행/빌드 문서화**이다

---

## 17) DAG 로컬 실행/빌드 사용문서 작성 계획

### 17.1 문서 목표
- 신규/기존 개발자가 로컬에서 DAG 패키지를 **빌드/테스트/실행 검증**할 수 있도록 절차를 제공한다.
- “문서에 적힌 명령이 실제로 동작한다”를 필수 기준으로 한다.

### 17.2 문서 산출물 (예정)
- 경로: `.design/specs/dag-local-run-and-build-guide.md` (가제)
- 언어: 한국어(설명) + 영어(명령/코드/로그 키워드)

### 17.3 문서 섹션 구조(초안)
1. Prerequisites (Node/pnpm/workspace 전제)
2. Monorepo 기준 DAG 패키지 빌드
3. DAG 패키지 테스트 실행
4. 로컬 실행 확인 시나리오 (mock 기반)
5. 로컬 웹 연계 안내
   - 현재 `dag-designer`는 SDK 패키지이며 단독 웹 서버가 아님
   - 실제 웹 화면은 호스트 앱(예: 별도 web app)에서 패키지 연동 필요
6. Troubleshooting (자주 실패하는 케이스와 해결 절차)

### 17.4 명령 검증 프로토콜 (강제)
- 문서에 넣기 전, 아래 규칙을 만족해야 한다:
  - 각 명령은 실제 로컬에서 실행해 성공 여부 확인
  - 성공한 명령만 최종 문서 본문에 포함
  - 실패 시 우회/fallback 명령을 추가하지 않고 원인/해결조건을 명시

- 기본 검증 명령 묶음(확정, 순차 실행):
  - Build:
    - `pnpm --filter @robota-sdk/dag-core build`
    - `pnpm --filter @robota-sdk/dag-runtime build`
    - `pnpm --filter @robota-sdk/dag-worker build`
    - `pnpm --filter @robota-sdk/dag-scheduler build`
    - `pnpm --filter @robota-sdk/dag-projection build`
    - `pnpm --filter @robota-sdk/dag-api build`
    - `pnpm --filter @robota-sdk/dag-designer build`
    - `pnpm --filter @robota-sdk/api-server build`
    - `pnpm --filter @robota-sdk/web build`
  - Test:
    - `pnpm --filter @robota-sdk/dag-core test`
    - `pnpm --filter @robota-sdk/dag-runtime test`
    - `pnpm --filter @robota-sdk/dag-worker test`
    - `pnpm --filter @robota-sdk/dag-scheduler test`
    - `pnpm --filter @robota-sdk/dag-projection test`
    - `pnpm --filter @robota-sdk/dag-api test`
    - `pnpm --filter @robota-sdk/dag-designer test`
  - Dev/Start:
    - `pnpm --filter @robota-sdk/api-server dag:dev`
    - `pnpm --filter @robota-sdk/web start`

주의:
- `pnpm --filter '@robota-sdk/dag-*' test`는 병렬 실행 환경에서 일부 타이밍 테스트가 간헐 실패할 수 있으므로 표준 명령으로 사용하지 않는다.

### 17.5 완료 기준
- 문서 초안이 `.design/specs/`에 생성되어 있음
- 문서 내 명령이 최신 코드 기준으로 재검증됨
- “SDK 패키지 실행”과 “웹 호스트 연계” 경계가 명확히 구분되어 있음

### 17.6 초안 작성 전 선행 작업(필수) 목록

아래 항목이 충족되지 않으면 사용 문서 초안을 작성하지 않는다.

#### A. 실행 진입점 명확화 (필수)
- [ ] A-1. DAG runtime/worker를 실제로 띄우는 로컬 진입점 선택
  - 옵션 1: `apps/api-server`에 DAG 조립/엔드포인트를 추가
  - 옵션 2: `apps/examples`에 DAG 실행 전용 runner 추가
  - 산출물: 실행 명령 1개(`pnpm --filter <target> dev` 또는 `pnpm --filter <target> start`)
- [ ] A-2. 진입점에서 DAG composition wiring 경로 고정
  - `createDagExecutionComposition`/`createDagControllerComposition` 사용 경로 문서화
  - no-fallback 기본 정책(`retryEnabled=false`, `reinjectEnabled=false`) 명시

#### B. 웹 연계 경계 확정 (필수)
- [ ] B-1. `dag-designer` 단독 서버 불가 사실을 문서 정책으로 고정
  - `dag-designer`는 SDK 패키지이며 host app에서 렌더링해야 함
- [ ] B-2. host app 선택 및 의존성 연결 계획 확정
  - 현재 `apps/web`에는 DAG 패키지 의존이 없음
  - 필요 시 `apps/web` 또는 별도 host에 `@robota-sdk/dag-designer`, `@robota-sdk/dag-api` 계약 연동 계획 수립
- [ ] B-3. “로컬 웹 확인”의 최소 성공 시나리오 정의
  - 예: host app 실행 -> designer 화면 렌더 -> validate/publish API 호출 성공

#### C. 명령 재현성 보강 (필수)
- [ ] C-1. 루트/패키지별 실행 명령 표준화
  - build/test/dev 명령을 단일 표로 확정
- [ ] C-2. 선행 조건 체크리스트 작성
  - Node/pnpm 버전, `pnpm install`, 환경변수 파일 요구사항
- [ ] C-3. 실패 케이스 기준 문구 확정
  - fallback 우회 명령 금지
  - 실패 시 원인/해결조건만 기록

#### D. 검증 로그 수집 포맷 (필수)
- [ ] D-1. 명령 검증 결과 기록 템플릿 정의
  - `command`, `cwd`, `expected`, `actual`, `result(pass/fail)` 필수
- [ ] D-2. 문서 반영 게이트 정의
  - Pass 기록이 있는 명령만 가이드 본문에 포함

### 17.7 선행 작업 완료 기준 (Gate)
- A~D의 체크박스가 모두 완료([x]) 상태
- “CLI 실행 경로”와 “웹 렌더 경로”가 각각 1개 이상 재현 가능
- 명령 검증 로그 템플릿으로 최소 1회 전체 리허설 완료

### 17.8 문서화 착수 조건
- 17.6/17.7 완료 후에만 `.design/specs/dag-local-run-and-build-guide.md` 작성 착수
- 착수 시점에 `CURRENT-TASKS`에 문서 작성 태스크를 별도 트랙으로 생성

### 17.9 실행 준비 작업 분해 (WBS)

#### Phase P-Doc-0: 경계/결정 고정
- [x] P-Doc-0-1. 실행 진입점 결정 (A-1)
  - 결정 문장 1줄로 고정: `api-server` 또는 `examples runner`
  - 산출물: 계획문서 1줄 결정 기록 + 이유 3개
- [x] P-Doc-0-2. 웹 host 전략 결정 (B-2)
  - 결정 문장 1줄로 고정: `apps/web 확장` 또는 `별도 host app`
  - 산출물: 선택한 host 경로 + 연동 범위
- [x] P-Doc-0-3. 정책 고정 (A-2, C-3)
  - no-fallback 기본 정책 문구를 문서 고정 문장으로 추가
  - 실패 시 우회 명령 금지 문구를 문서 고정 문장으로 추가

#### Phase P-Doc-1: 실행 경로 구현/정비
- [ ] P-Doc-1-1. CLI 실행 진입점 구현
  - 진입점에서 `createDagExecutionComposition`/`createDagControllerComposition` 사용
  - 최소 1개 실행 명령 제공 (`dev` 또는 `start`)
- [ ] P-Doc-1-2. 웹 렌더 진입점 구현
  - host app에서 `dag-designer` 렌더 경로 생성
  - API 계약 호출 경로(validate/publish/trigger 조회 중 최소 1개) 연결
- [ ] P-Doc-1-3. 환경변수/설정 파일 정리
  - 필수 키 목록, 기본값 허용 범위, 누락 시 오류 메시지 정리

#### Phase P-Doc-2: 명령 검증/로그화
- [ ] P-Doc-2-1. 명령 목록 확정 (C-1)
  - build/test/dev/start를 표준 명령 표로 확정
- [ ] P-Doc-2-2. 명령 실검증 1차
  - 각 명령을 clean 상태에서 1회 실행
  - 실패 명령은 원인/조건 보완 후 재시도
- [ ] P-Doc-2-3. 검증 로그 기록 (D-1)
  - 템플릿 기반으로 pass/fail 전부 기록

#### Phase P-Doc-3: 문서 작성/검토
- [ ] P-Doc-3-1. 사용자 가이드 초안 작성
  - 검증 통과 명령만 본문 반영
- [ ] P-Doc-3-2. 재검증 라운드
  - 문서만 보고 신규 터미널에서 재현 실행
- [ ] P-Doc-3-3. 완료 선언
  - 문서의 각 섹션에 대응하는 실제 실행 증거(log) 링크 첨부

### 17.10 산출물 정의 (파일 단위)

- [ ] 산출물-1: 실행 진입점 결정 기록 (본 계획문서 17장 하위)
- [ ] 산출물-2: 명령 검증 로그 문서
  - 경로: `.design/specs/dag-local-run-build-validation-log.md` (가제)
- [ ] 산출물-3: 사용자 가이드 문서
  - 경로: `.design/specs/dag-local-run-and-build-guide.md`

### 17.11 검증 로그 템플릿 (고정)

각 명령은 아래 형식으로 기록한다.

```md
### Command: <exact command>
- cwd: `<absolute-or-relative-path>`
- purpose: <why this command is required>
- expected: <expected success signal>
- actual: <key output summary>
- result: PASS | FAIL
- failure-cause: <only when FAIL>
- fix-condition: <only when FAIL>
```

### 17.12 일정/게이트 운영안

- Gate-Doc-1 (P-Doc-0 완료):
  - 실행 진입점/웹 host/정책 문구가 모두 결정됨
- Gate-Doc-2 (P-Doc-1 완료):
  - CLI 1경로 + 웹 1경로가 실제 실행됨
- Gate-Doc-3 (P-Doc-2 완료):
  - 표준 명령 전부 검증 로그 PASS
- Gate-Doc-4 (P-Doc-3 완료):
  - 가이드 문서 단독 재현 성공

진행 규칙:
- 각 Gate 실패 시 다음 Phase 진행 금지
- 실패는 숨기지 않고 실패 원인/조건을 먼저 문서화한 뒤 재검증

### 17.13 P-Doc-0 결정 고정안 (확정)

#### Decision-1: CLI 실행 진입점
- 확정: `apps/api-server`를 DAG 로컬 실행 진입점으로 사용한다.
- 이유:
  1. 현재 저장소에 `apps/examples`는 존재하지 않으며, 즉시 실행 가능한 앱 경로는 `apps/api-server`가 유일하다.
  2. `dag-api`의 composition(`createDagExecutionComposition`, `createDagControllerComposition`)을 서버 경로에 연결하기 가장 자연스럽다.
  3. 향후 실제 운영 API 경로로 확장할 때 재사용성이 높다.

#### Decision-2: 웹 host 전략
- 확정: `apps/web`를 DAG 디자이너 host app으로 확장한다.
- 이유:
  1. 이미 Next.js host가 존재하여 렌더링/라우팅 기반이 준비되어 있다.
  2. `dag-designer`는 SDK 패키지이므로 단독 서버가 아닌 host app 탑재가 원칙에 부합한다.
  3. 문서 사용자 입장에서 “웹 확인 경로”를 제공하기 쉽다.

#### Decision-3: 정책 고정 문구
- 고정 문구 A: DAG 로컬 실행 문서는 **fallback 우회 명령을 포함하지 않는다**.
- 고정 문구 B: 실행 실패 시 임시 재시도/대체 경로를 추가하지 않고 **실패 원인과 충족 조건**만 기록한다.
- 고정 문구 C: 기본 정책은 `retryEnabled=false`, `reinjectEnabled=false`이며, 예외 동작은 명시적 opt-in 설정에서만 허용한다.

### 17.14 P-Doc-1-1 구현 결과 (실행 진입점)

- 구현 위치: `apps/api-server/src/dag-dev-server.ts`
- 추가 스크립트:
  - `pnpm --filter @robota-sdk/api-server dag:dev`
  - `pnpm --filter @robota-sdk/api-server dag:start`
- 빌드 엔트리 반영: `apps/api-server/tsup.config.ts`
- 의존성 반영: `@robota-sdk/dag-api`, `@robota-sdk/dag-core`

검증된 최소 실행 플로우(로컬):
1. `pnpm --filter @robota-sdk/api-server dag:dev`
2. `POST /v1/dag/dev/bootstrap`
3. `POST /v1/dag/dev/runs`
4. `POST /v1/dag/dev/workers/process-once` (필요 횟수만큼)
5. `GET /v1/dag/dev/runs/:dagRunId`
6. `GET /v1/dag/dev/observability/:dagRunId/dashboard`

비고:
- 현재 플로우는 in-memory adapter 기반 개발 검증 경로이며, 운영 영속 저장소/큐는 P-Doc-1-3 이후 단계에서 별도 정의한다.

### 17.15 P-Doc-1-2 구현 결과 (웹 host 렌더 경로)

- 구현 위치: `apps/web/src/app/dag-designer/page.tsx`
- 의존성 추가:
  - `@robota-sdk/dag-designer`
  - `@robota-sdk/dag-core`
- 페이지 기능:
  - `DesignerApiClient` 기반 `Create Draft / Validate / Publish` 버튼 제공
  - 기본 API base URL: `NEXT_PUBLIC_DAG_API_BASE_URL` 또는 `http://localhost:3011`

검증 결과:
1. `pnpm --filter @robota-sdk/web build` 성공
2. `pnpm --filter @robota-sdk/web start` 후 `/dag-designer` 라우트 HTML 렌더 확인
3. 페이지 내 `DAG Designer Host (Web)` 및 action 버튼 노출 확인

비고:
- 본 단계는 “host app에서 dag-designer 렌더 경로 확보”에 초점을 둔다.
- 운영 수준 인증/권한/고급 UX는 문서화 단계(P-Doc-3)에서 범위를 분리해 명시한다.

### 17.16 P-Doc-1-3 환경변수/설정 요구사항 고정

#### A. `apps/api-server` (DAG dev 서버)
- 예제 파일: `apps/api-server/.env.example`
- 필수 키(로컬 DAG dev 기준):
  - `DAG_DEV_PORT` (기본값 `3011`)
- 선택 키:
  - `NODE_ENV`, `PORT`, `CORS_ORIGINS`, `RATE_LIMIT_MAX`
  - `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` (remote API 기능용)

#### B. `apps/web` (DAG designer host)
- 예제 파일: `apps/web/.env.dag.example`
- 필수 키(로컬 DAG 연동 기준):
  - `NEXT_PUBLIC_DAG_API_BASE_URL` (기본값 `http://localhost:3011`)
- 선택 키:
  - `NEXT_PUBLIC_API_VERSION` (`v1`)

#### C. 설정 적용 절차(로컬)
1. API 서버:
   - `apps/api-server/.env.example`를 기준으로 `.env` 구성
2. Web host:
   - `apps/web/.env.dag.example`를 `.env.local`에 반영
3. 실행:
   - `pnpm --filter @robota-sdk/api-server dag:dev`
   - `pnpm --filter @robota-sdk/web start` (또는 `dev`)

#### D. 실패 처리 원칙 (재확인)
- 환경변수 누락 시 fallback 대체값으로 흐름을 숨기지 않는다.
- 문서에는 “누락 키”, “실패 증상”, “충족 조건”을 명시한다.

### 17.17 P-Doc-2 진행 결과 (명령 검증/로그화)

- 표준 명령표 확정: 17.4 항목 기준으로 고정
- 1차 실검증 완료:
  - DAG 패키지 build/test 순차 실행 PASS
  - `api-server` DAG dev 서버 기동 및 design/runtime/observability 경로 응답 PASS
  - `web` host start 및 `/dag-designer` 라우트 응답 PASS
- 검증 로그 문서:
  - `.design/specs/dag-local-run-build-validation-log.md`

### 17.18 P-Doc-3-1 진행 결과 (사용자 가이드 초안)

- 초안 문서 생성:
  - `.design/specs/dag-local-run-and-build-guide.md`
- 반영 원칙:
  - 검증 로그에서 PASS 확인된 명령만 본문에 반영
  - no-fallback 원칙 및 실패 처리 규칙을 명시
  - CLI 경로와 Web host 경로를 분리해 설명

### 17.19 P-Doc-3-2 진행 결과 (문서 단독 재현)

- 문서 기준 재현 라운드 수행:
  - `/` -> `/dag-designer` 리다이렉트 확인
  - Browser MCP로 `Create / Validate / Publish` 클릭 검증
  - 콘솔 에러 없음 확인
- CORS 경계 검증:
  - preflight(OPTIONS) 응답 헤더 검증
  - browser origin 포함 POST 요청 정상 응답 검증
- 반영 문서:
  - `.design/specs/dag-local-run-build-validation-log.md` 섹션 5
  - `.design/specs/dag-local-run-and-build-guide.md` 트러블슈팅(CORS) 업데이트

### 17.20 P-Doc-3-3 완료 선언 (증거 링크 정리)

- 완료 증거:
  - Guide: `.design/specs/dag-local-run-and-build-guide.md`
  - Validation Log: `.design/specs/dag-local-run-build-validation-log.md`
  - 실행 진입점: `apps/api-server/src/dag-dev-server.ts`
  - 웹 host 경로: `apps/web/src/app/dag-designer/page.tsx`
- 상태:
  - P-Doc-3 완료
  - Gate-Doc-4 통과

