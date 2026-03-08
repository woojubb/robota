# Dagster 서버 아키텍처 분석

**Python, 2019~**

자산 중심(Asset-Centric) 패러다임의 데이터 오케스트레이션 플랫폼. Software-Defined Assets(SDA)가 핵심 차별점.

## 레이어 분리

```
Webserver (Dagster UI)          ← GraphQL API + React UI
  │
  ├── gRPC ──→ Code Location Server(s)   ← 정의(assets, jobs, resources) 호스팅
  │
Daemon (단일 인스턴스)          ← 스케줄/센서/런 큐/모니터링
  │
  ├── Run Queue Daemon          ← 대기 중 Run을 우선순위/동시성에 따라 실행
  ├── Scheduler Daemon          ← 활성 스케줄에서 Run 생성
  ├── Sensor Daemon             ← 활성 센서에서 Run 생성
  └── Run Monitoring Daemon     ← Run Worker 장애 감지/복구
  │
Run Launcher                    ← Run Worker 프로세스/Pod 생성
  └── Run Worker                ← 실행 계획 순회 → Executor로 Step 실행
  │
Storage (PostgreSQL/SQLite)     ← 3가지 분리된 스토어
```

### 설정 3계층

| 계층 | 파일 | 범위 |
|------|------|------|
| Instance | `dagster.yaml` | 배포 전역 (DB, Run Launcher 등) |
| Workspace | `workspace.yaml` | Code Location 접근 및 로딩 |
| Job Run | Run config | Job 단위 (Executor, Ops, Resources) |

### 실행 흐름

1. UI/API에서 Run 요청 → Run Coordinator가 Run을 큐에 등록
2. Daemon의 Run Queue Daemon이 큐에서 Run을 꺼내 Run Launcher 호출
3. Run Launcher가 Run Worker 프로세스/Pod 생성
4. Run Worker가 실행 계획을 순회하며 Executor를 통해 각 Step 실행
5. Schedule/Sensor 경유 시 Webserver를 거치지 않고 Daemon에서 직접 시작

## DAG/워크플로우 정의 모델

### Software-Defined Assets (SDA)

전통적인 태스크/워크플로 중심에서 **자산 중심의 선언적 패러다임**으로 전환:

```python
@asset
def raw_orders():
    """S3에서 주문 데이터 로드"""
    return load_from_s3("orders")

@asset(deps=[raw_orders])
def cleaned_orders(raw_orders):
    """주문 데이터 정제"""
    return clean(raw_orders)
```

- Asset은 영속 스토리지의 데이터 객체(DB 테이블, S3 파일, ML 모델 등)를 코드로 정의
- 각 Asset 정의: (1) 존재 선언, (2) 업스트림 의존성, (3) 값 계산 함수
- Dagster가 의존성을 추적하여 **Asset Graph를 자동 추론** → 수동 DAG 정의 불필요

### Ops, Graphs, Jobs

- `@op`: 단일 연산 단위 (Asset보다 저수준)
- `@graph`: Op 조합으로 복합 연산 정의
- `@job`: 실행 가능한 Graph 인스턴스
- Graph-backed assets: 복수 Op로 구성된 자산

## 노드/태스크 모델

### Asset/Op 데코레이터

```python
@asset(
    io_manager_key="warehouse_io_manager",
    retry_policy=RetryPolicy(max_retries=3),
    code_version="v2",
)
def my_asset(context, upstream_asset):
    # context: OpExecutionContext
    return result
```

### IO Manager

Op/Asset의 출력 저장과 입력 로딩을 추상화하는 핵심 인터페이스:

- `handle_output(context, obj)` — 출력을 영속 스토리지에 기록
- `load_input(context)` — 업스트림 출력을 읽어 다운스트림 입력으로 제공

**설계 의의**:
- 비즈니스 로직에서 데이터 영속화를 완전히 분리
- 환경별(개발/스테이징/프로덕션) IO Manager 교체 가능
- Context 객체로 asset name, partition key 등 메타데이터 접근

### 타입 시스템 (런타임 검증)

```python
EvenDagsterType = DagsterType(
    name="EvenDagsterType",
    type_check_fn=lambda _, value: isinstance(value, int) and value % 2 == 0,
)
```

- PEP 484 정적 타입과 별도로 **런타임 값 검증** 수행
- Op 실행 시점에 입력/출력 타입 검증 → 실패 시 실행 중단, 이벤트 로그 기록
- Pandera, Pydantic 등 외부 검증 라이브러리 통합 가능

## 실행 모델

### Executor 타입

| Executor | 실행 방식 | 적합 환경 |
|----------|-----------|-----------|
| `in_process_executor` | Run Worker 내 직렬 실행 | 개발, 디버깅 |
| `multiprocess_executor` (기본) | Step별 별도 프로세스 | 중간 규모 |
| `dask_executor` | Dask 분산 실행 | Dask 클러스터 |
| `celery_executor` | Celery 태스크 큐 | 분산 워커 |
| `docker_executor` | Docker 컨테이너 격리 | 컨테이너 환경 |
| `k8s_job_executor` | K8s Pod 격리 | Kubernetes |
| `celery_k8s_job_executor` | K8s Pod + Celery 제어 | K8s + 큐잉 |

### K8s + Celery 실행 흐름

1. Run Worker K8s Job이 실행 계획 순회 → Step을 Celery 큐에 제출
2. Celery Worker가 큐에서 Step을 꺼내 Step Execution K8s Job 생성
3. 각 Step이 격리된 Pod에서 실행

## 데이터 흐름

### IO Manager 기반

- Op 출력 → IO Manager의 `handle_output()`이 자동 저장
- 다운스트림 Op 입력 → IO Manager의 `load_input()`이 자동 로딩
- 파티션 키, 자산 이름 등 메타데이터가 Context에 포함
- 환경별로 IO Manager를 교체하여 동일 코드로 다른 스토리지 사용

### 데이터 전달 패턴

- **인프로세스**: Python 객체 직접 전달 (메모리)
- **멀티프로세스**: IO Manager를 통한 간접 전달 (파일시스템/DB)
- **분산**: IO Manager를 통한 간접 전달 (S3/GCS/데이터 웨어하우스)

## 상태 관리

### DagsterRunStatus (9 상태)

```
NOT_STARTED → QUEUED → STARTING → STARTED → SUCCESS ✓
                                           → FAILURE ✓
                                  → CANCELING → CANCELED ✓
```

| 상태 | 설명 |
|------|------|
| `NOT_STARTED` | 생성, 실행 미시작 |
| `QUEUED` | 실행 큐 대기 |
| `STARTING` | Run Worker 초기화 |
| `STARTED` | 활성 실행 중 |
| `MANAGED` | 외부 시스템 관리 상태 |
| `SUCCESS` | 성공 완료 |
| `FAILURE` | 오류로 미완료 |
| `CANCELING` | 취소 처리 중 |
| `CANCELED` | 취소 완료 |

**Robota 대비 특이점**:
- `NOT_STARTED` 상태 (Robota의 `created`와 유사)
- `STARTING` 상태 (Worker 스핀업 과정)
- `CANCELING` 중간 상태 (Robota는 즉시 `cancelled`)
- `MANAGED` 상태 (외부 시스템 관리)

### Step 수준 이벤트

Step 단위로 별도 상태 머신이 아닌 **이벤트 로그** 기반:
- `STEP_START`, `STEP_SUCCESS`, `STEP_FAILURE`, `STEP_OUTPUT`, `STEP_INPUT`
- Asset 이벤트: `ASSET_MATERIALIZATION`, `ASSET_OBSERVATION`, `ASSET_CHECK_EVALUATION`

## 스토리지/영속성

**3가지 분리된 스토어** + append-only 이벤트 로그 + 비정규화 캐시 이중 전략:

### Event Log Storage

| 컬럼 | 역할 |
|------|------|
| `id` | auto-increment PK |
| `run_id` | 인덱스 |
| `dagster_event_type` | 인덱스 |
| `asset_key` | 인덱스 |
| `partition` | 인덱스 |
| `timestamp` | 인덱스 |
| `event` | 직렬화된 EventLogEntry blob |

**비정규화 캐시 (`asset_keys` 테이블)**: 최신 materialization, 캐시 상태 등 → O(1) 조회.

### Run Storage

- `runs` 테이블: `run_id`, `status`, `run_body` (직렬화된 DagsterRun), 타임스탬프

### Schedule Storage

- 센서/스케줄 자동화 상태, 커서, 틱 레코드, 실행 이력

### 백엔드

| 구현체 | 용도 |
|--------|------|
| SQLite | 로컬 개발/테스트 (파일 기반) |
| PostgreSQL (권장) | 프로덕션 (LISTEN/NOTIFY, 동시성) |
| MySQL | 프로덕션 대안 |

### 실시간 구독

- SQLite: 폴링 기반 `watch()` API
- PostgreSQL: `LISTEN/NOTIFY` 메커니즘

### 동시성 관리

- `ConcurrencySlotsTable`: 실행 슬롯 점유 추적
- `ConcurrencyLimitsTable`: 키별 제한 정의
- `PendingStepsTable`: 가용 슬롯 대기 Step 큐

## 서버 API

### GraphQL API (주 인터페이스)

- Schema-first 설계: `schema.graphql` (75,000+ 라인)
- Python Graphene 리졸버
- 모든 요청은 `WorkspaceRequestContext` 내에서 실행

**주요 Query**:
- `get_assets()` — 커서 기반 페이지네이션으로 자산 목록
- `gen_run_by_id()` — 단일 Run 조회
- `get_runs()` — 필터 + 페이지네이션으로 Run 목록
- `get_logs_for_run()` — Run별 이벤트 스트리밍

**주요 Mutation**:
- `launchPipelineExecution` — Run 실행 (권한 → 설정 검증 → DagsterRun 생성 → ExecutionPlan → RunCoordinator 제출)
- `launchPartitionBackfill` / `cancelPartitionBackfill` / `resumePartitionBackfill` — 백필 관리

**오류 처리**: GraphQL Union 타입으로 표현 (예외 아님):
- `PythonError`, `UnauthorizedError`, `AssetNotFoundError`, `InvalidSubsetError`

**성능 최적화**:
- DataLoader 패턴으로 DB 쿼리 배칭
- `CachingStaleStatusResolver`: staleness 계산 메모이제이션
- `RepositoryScopedBatchLoader`: 반복 서브 쿼리 중복 제거

### REST API

GraphQL 외에 REST API도 제공. 자산/런/이벤트 조회.

### 클라이언트 통합 (UI)

- Apollo Client + `@graphql-codegen/cli`로 TypeScript 타입 자동 생성
- `.graphql` 파일에서 React Hook 자동 생성

## 이벤트/진행 보고

### Event Log 시스템

- `DagsterEventType` 열거형: 130+ 이벤트 유형
- 모든 실행 기록이 **append-only 이벤트 로그**로 영속 저장
- 기본 이벤트(실행 시작/종료)는 자동 발행
- 커스텀 이벤트(`AssetMaterialization`, `ExpectationResult`)는 명시적 발행
- `dagster._serdes`의 버전 관리 직렬화로 역호환성 보장

### 이벤트 카테고리

| 카테고리 | 주요 이벤트 |
|----------|-----------|
| Asset | `ASSET_MATERIALIZATION`, `ASSET_OBSERVATION`, `ASSET_CHECK_EVALUATION` |
| Run | `RUN_START`, `RUN_SUCCESS`, `RUN_FAILURE`, `RUN_CANCELED` |
| Step | `STEP_START`, `STEP_SUCCESS`, `STEP_FAILURE`, `STEP_OUTPUT` |

### UI 갱신

- Dagster UI에서 폴링하여 이벤트 로그 표시
- PostgreSQL 환경에서는 LISTEN/NOTIFY로 효율적 구독

## 에러 처리 & 재시도

### RetryPolicy

```python
@op(retry_policy=RetryPolicy(
    max_retries=3,
    delay=30,
    backoff=Backoff.EXPONENTIAL,
    jitter=Jitter.PLUS_MINUS,
))
def my_op():
    ...
```

**적용 수준**:
1. Op 정의: `@op(retry_policy=...)`
2. Op 호출: `.with_retry_policy()`
3. Job 전체: `define_asset_job(op_retry_policy=...)`

**수동 재시도**: `RetryRequested` 예외로 조건부 재시도 제어. `raise from`으로 원본 예외 보존.

**Op Retry vs Run Retry**:
- Op Retry: 개별 Op/Step 수준
- Run Retry: 전체 Run 수준 (`run_retries` 설정)

**제약**: Dagster 프로세스 크래시 시 RetryPolicy 미동작 (Run은 격리 프로세스).

## 캐싱

### Memoization (버전 기반 캐싱)

**코드 버전 (`code_version`)**:
- Asset/Op에 문자열로 버전 할당
- 결정론적 결과를 보장할 때만 사용

**데이터 버전 (`DataVersion`)**:
- 자산 데이터의 버전 문자열
- 각 materialization마다 자동 계산: 코드 버전 + 입력 자산 데이터 버전 해싱

**결과 스킵 로직**:
- 코드 버전 동일 + 입력 데이터 버전 동일 → materialization 스킵
- 불필요한 재계산 방지, 컴퓨팅 자원 절약

## 특이점

### 자산 중심(Asset-Centric) 패러다임

1. **선언적 정의**: "무엇이 존재해야 하는가"를 선언, 실행 세부사항은 IO Manager와 Executor가 처리
2. **자동 DAG 추론**: 의존성 선언으로 Asset Graph 자동 구축
3. **데이터 리니지**: 세밀한 자산 간 추적
4. **파티션 지원**: 시간/키 기반 증분 처리

### 설계 철학

- **IO Manager로 관심사 분리**: 비즈니스 로직 ≠ 데이터 I/O
- **이벤트 소싱**: append-only 로그가 실행 이력의 SSOT
- **플러그형 구성**: Executor, Run Launcher, Storage, IO Manager 모두 교체 가능
- **GraphQL 중심**: 단일 API 진입점으로 모든 클라이언트 상호작용
