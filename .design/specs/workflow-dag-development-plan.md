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
  - `IDagDefinition`, `IDagNode`, `IDagNodeDefinition`, `IDagRun`, `ITaskRun`
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

## 17) DAG 문서화/노드구조 계획 정리 상태 (2026-02-15 반영)

본 문서의 계획 항목 중 완료된 트랙은 체크리스트를 유지하지 않고 완료 상태로 정리한다.
상세 실행 증거와 산출물은 완료 기록/전용 스펙 문서에서 관리한다.

### 17.1 완료 처리된 트랙
- DAG 로컬 실행/빌드 문서화 트랙(P-Doc)은 Gate-Doc-1~4까지 완료됨
- DAG 노드 패키지 분리(`packages/dag-nodes/*`, `@robota-sdk/dag-node-*`)는 하드 컷오버 완료됨
- Node Definition 책임 정렬(`IDagNodeDefinition` SSOT, manifest/configSchema 중앙 assembly 파생) 완료됨

### 17.2 현실 정합성 정리
- 본 문서에서 더 이상 유효하지 않은 미완료 체크박스/예정(초안) 항목은 제거함
- 남은 작업 관리는 `.design/open-tasks/CURRENT-TASKS.md`만 단일 기준으로 사용함
- 완료 이력은 `.design/open-tasks/COMPLETED-TASKS.md`에 날짜/단위별로 누적 관리함

### 17.3 참조 문서
- `.design/specs/dag-local-run-and-build-guide.md`
- `.design/specs/dag-local-run-build-validation-log.md`
- `.design/specs/dag-local-node-store-spec.md`
- `.design/open-tasks/CURRENT-TASKS.md`
- `.design/open-tasks/COMPLETED-TASKS.md`

