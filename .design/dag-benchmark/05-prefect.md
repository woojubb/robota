# Prefect 서버 아키텍처 분석

**Python, 2018~**

"Negative Engineering" 철학 기반의 워크플로우 오케스트레이션 플랫폼. DAG 강제 없이 네이티브 Python 제어 흐름을 수용.

## 레이어 분리

```
API Server (FastAPI)            ← REST API, 오케스트레이션 규칙 엔진
  │
  ├── Orchestration Engine      ← 상태 전환 거버넌스 (OrchestrationRule 체인)
  │
Database (PostgreSQL/SQLite)    ← 실행 상태의 SSOT
  │
Work Pool                       ← 오케스트레이션 작업 채널 (pub/sub "topic")
  │
  ├── Worker                    ← 사용자 환경에서 동작하는 폴링 프로세스
  │     └── Task Runner         ← ThreadPool / ProcessPool / Dask / Ray
  │
Result Store (S3/GCS/로컬)      ← 실행 결과 저장 (DB와 분리)
```

### 서버 역할

- Flow run과 Task run의 상태 정보를 수신하고 검증
- Deployment 실행 지시를 Work Pool을 통해 Worker에 전달
- 동시 요청 수 제한 미들웨어 포함
- 데이터베이스가 실행 상태의 **단일 진실 소스(SSOT)**

### 기술 스택

- **웹 프레임워크**: FastAPI + Uvicorn
- **ORM**: SQLAlchemy (async — `aiosqlite`, `asyncpg`)
- **DB**: SQLite(기본, 개발) 또는 PostgreSQL(프로덕션)
- **마이그레이션**: Alembic

## DAG/워크플로우 정의 모델

### No-DAG 철학

Prefect의 근본 설계 철학: **워크플로우가 명시적 DAG로 작성될 필요가 없다**.

```python
@flow
def my_pipeline(data_source: str):
    raw = extract(data_source)

    if raw.needs_cleaning:          # 네이티브 Python if/else
        cleaned = clean(raw)
    else:
        cleaned = raw

    for batch in cleaned.batches:   # 네이티브 Python for
        load(batch)
```

- DAG 기반 시스템에서는 제어 흐름을 오케스트레이터에 위임 → 전용 "operator" 필요
- Prefect는 `if/else`, `while`, `for`, 예외 처리 등 Python 제어 흐름 그대로 사용
- **동적 실행 모델**: DAG를 런타임에 결정
- YAML/커스텀 DSL 없이 순수 Python

## 노드/태스크 모델

### @flow / @task 데코레이터

```python
@task(retries=3, retry_delay_seconds=10, cache_key_fn=task_input_hash)
def extract(source: str):
    return fetch_data(source)

@flow(name="ETL Pipeline")
def etl_pipeline():
    data = extract("s3://bucket/data")
    transformed = transform(data)
    load(transformed)
```

- `@flow`: 함수를 감싸서 API에 Flow Run 생성, 상태 전환 자동 추적
- `@task`: 함수를 감싸서 API에 Task Run 생성, Task Runner에 제출
- 동기/비동기 함수 모두 지원
- Task 오케스트레이션은 **클라이언트 사이드**에서 주로 처리 (효율성)

### Task Runner

| Runner | 실행 방식 |
|--------|-----------|
| `ThreadPoolTaskRunner` | 로컬 스레드 풀 |
| `ProcessPoolTaskRunner` | 로컬 프로세스 풀 |
| `PrefectTaskRunner` | Prefect 기본 |
| Ray / Dask | 외부 분산 플랫폼 |

## 실행 모델

### Work Pool + Worker 구조

**Work Pool (3가지 유형)**:
1. **Managed**: Prefect가 제출과 실행 모두 관리
2. **Push**: 서버리스 인프라에 직접 제출 (폴링 불필요)
3. **Pull**: Worker가 능동적으로 폴링하여 실행

**Worker**: 사용자 실행 환경의 경량 폴링 프로세스. Work Pool 타입과 매칭.

**Work Queue**: 각 Work Pool에 "default" 큐 포함. 추가 큐로 우선순위/동시성 제어.

**실행 흐름**:
```
Deployment → Flow Run 생성 → Work Pool에 스케줄링 → Worker 폴링 → 실행 환경에서 실행
```

### Prefect 3 트랜잭션 시스템

- Task를 원자적 단위(atomic unit)로 그룹화
- 4단계: `BEGIN → STAGE → COMMIT` 또는 `ROLLBACK`
- `on_rollback` / `on_commit` 훅
- 결과 영속화는 커밋 시점에만 발생

## 데이터 흐름

### 함수 반환값 기반

```python
@task
def extract():
    return data         # 반환값이 곧 다음 태스크 입력

@flow
def pipeline():
    data = extract()    # 자연스러운 Python 데이터 전달
    transform(data)
```

- 별도 XCom이나 IO Manager 없이 Python 함수 반환값으로 직접 전달
- 대용량 결과는 Result Store에 자동 영속화

### Result Store

**"Decomposed Durability" 설계 원칙**:
- 결과가 오케스트레이터 DB에 잠기지 않고 사용자 소유 스토리지에 저장
- 주소 지정 가능(addressable) → 워크플로우 간 공유 가능

**지원 백엔드**: S3, GCS, Azure Blob, 로컬 파일시스템 (`~/.prefect/storage/`)

**파일명 규칙**: Task는 캐시 정책 해시값, Flow는 랜덤 UUID

## 상태 관리

### State Type vs State Name

| 카테고리 | State Type | 설명 |
|---------|-----------|------|
| 비종료 | `SCHEDULED` | 미래 시간에 시작 예정 |
| 비종료 | `PENDING` | 제출됨, 전제 조건 대기 |
| 비종료 | `RUNNING` | 현재 실행 중 |
| 비종료 | `CANCELLING` | 취소 진행 중 |
| 비종료 | `PAUSED` | 일시 중지 |
| 종료 | `COMPLETED` | 성공 반환 |
| 종료 | `FAILED` | 에러/예외 발생 |
| 종료 | `CANCELLED` | 사용자 취소 |
| 종료 | `CRASHED` | 인프라 문제로 중단 |

**State Name vs Type 분리**:
- Name: 시각적 표시/기록 (예: `Retrying`)
- Type: 오케스트레이션 로직의 근거 (예: `RUNNING`)
- 첫 실행: name=`Running`, type=`RUNNING`. 재시도: name=`Retrying`, type=`RUNNING`

**State 객체 속성**: `type`, `name`, `timestamp`, `message`, `result`, `state_details`

**Robota 대비 특이점**:
- `PAUSED` 상태 (Robota에 없음)
- `CRASHED` 상태 (인프라 문제 구분)
- `PENDING` 상태 (Robota의 `created`와 유사하지만 전제 조건 대기 의미)
- State Name/Type 분리 (같은 Type에 다른 Name 가능)

### Orchestration Engine (서버 사이드)

상태 전환을 거버넌스하는 핵심 메커니즘:

- **OrchestrationContext**: 전환 세부사항 담는 컨텍스트 (`initial_state` + `proposed_state`)
- **OrchestrationRule**: 상태 전환을 통제하는 상태풀 컨텍스트 매니저

**규칙의 3가지 훅**:
1. `before_transition` — 부작용 생성, proposed state 변경 가능
2. `after_transition` — 검증된 상태에 대한 후처리
3. `cleanup` — before_transition의 부작용 되돌림

**상태 전환 검증 흐름**:
1. 클라이언트가 proposed state를 API에 제출
2. OrchestrationRule 체인이 순차적으로 검증/수정
3. 통과 시 SQLAlchemy 세션에 추가 + flush
4. 규칙이 proposed state를 `None`으로 설정 가능 → 변경 없이 종료

## 스토리지/영속성

| 대상 | 저장소 |
|------|--------|
| 실행 메타데이터 (Flow/Task run) | PostgreSQL / SQLite |
| 실행 결과 | Result Store (S3/GCS/Azure/로컬) |
| 이벤트 (Prefect Cloud) | ClickHouse |

- 오케스트레이션과 결과 저장 **분리** ("Decomposed Durability")
- DB는 실행 상태의 SSOT
- Alembic으로 스키마 마이그레이션

## 서버 API

### REST API

**설계 규칙**:
- 컬렉션명 복수형: `/flows`, `/task_runs`
- snake_case 라우트명
- 중첩 리소스 회피: `/task_runs`는 flow run 필터로 조회
- GET, PUT, DELETE는 항상 멱등

**주요 엔드포인트**:
- `POST /flow_runs/filter` — Flow run 필터링
- `POST /flow_runs/count` — 집계
- `POST /flow_runs/history` — 이력
- `POST /deployments/{id}/create_flow_run` — Deployment에서 Run 생성
- `POST /task_runs/set_state` — Task run 상태 설정

**필터링/페이지네이션**:
- POST 요청 본문에 필터, 정렬, 페이지네이션
- `limit` + `offset` 페이지네이션
- 단일 `sort` 파라미터

## 이벤트/진행 보고

### Events

- Prefect 객체(flow, task, deployment, work queue, log)가 자동 이벤트 발신
- 리소스(resource) + 액션(action) 문법
- `emit_event(event=..., resource=...)` 함수로 커스텀 이벤트 발신
- 모든 이벤트 저장 → UI에서 디버깅/감사

### Automations

- **Trigger**: 이벤트 발생(또는 부재)에 기반한 조건
- **Action**: 조건 충족 시 자동 실행 작업
- **Target**: Selected(명시적) 또는 Inferred(트리거에서 추론)

### Webhooks

- 외부 HTTP 요청을 Prefect 이벤트로 변환
- 정적/동적/CloudEvents 기반 이벤트 생성

### 백엔드 (Prefect Cloud)

- ClickHouse 기반 이벤트 저장 (BigQuery + PostgreSQL에서 마이그레이션)
- 하루 100만+ Flow run 처리, 멀티 테넌트 아키텍처

## 에러 처리 & 재시도

### 재시도 설정

```python
@task(retries=3, retry_delay_seconds=[10, 30, 60])
def flaky_task():
    ...
```

- `retries`: 최대 재시도 횟수
- `retry_delay_seconds`: 재시도 대기 (리스트로 단계별 설정 가능)
- 지수 백오프 지원
- 성공한 태스크는 캐싱으로 건너뛰기

### 상태 기반 재시도

- 재시도 시 State Name = `Retrying`, State Type = `RUNNING`
- 서버 사이드 OrchestrationRule이 재시도 로직 관리

## 캐싱

### Prefect 2 방식 (cache_key_fn)

```python
@task(cache_key_fn=task_input_hash, cache_expiration=timedelta(hours=1))
def expensive_computation(data):
    ...
```

- `cache_key_fn(context, parameters) → str`: 캐시 키 생성 함수
- `task_input_hash`: 내장 함수 (모든 입력 해싱)
- `cache_expiration`: `timedelta`로 만료 기간

### Prefect 3 방식 (Cache Policy)

| 정책 | 설명 |
|------|------|
| `DEFAULT` | 입력 + 코드 + flow_run_id |
| `INPUTS` | 입력만 |
| `TASK_SOURCE` | 소스코드 |
| `FLOW_PARAMETERS` | 부모 flow 파라미터 |
| `NO_CACHE` | 캐싱 비활성화 |

- 정책 합성: Python `+` 연산자로 결합 (`INPUTS + TASK_SOURCE`)
- 격리 수준: `READ_COMMITTED`(기본) / `SERIALIZABLE`(분산 락)

### 캐싱 동작

1. Task run 시작 시 캐시 키 계산
2. Result storage에서 키로 레코드 조회
3. 만료되지 않은 레코드 발견 → 실행 건너뛰고 `Cached` 상태로 전환
4. 저장 위치: `~/.prefect/storage/` (파일명 = 캐시 키)

## 특이점

### "Negative Engineering" 철학

Prefect 창업자 Jeremiah Lowin의 개념:

- **Positive Engineering**: 목표 달성을 위한 코드
- **Negative Engineering**: positive 코드가 실행되도록 하는 방어적 코드 (재시도, 로깅, 에러 처리, 관찰 가능성)
- 엔지니어가 시간의 ~90%를 negative 이슈에 소비, ~10%만 실제 솔루션에 투입
- 기본 빌딩 블록(`@flow`, `@task`)에 negative 이슈 해결을 내장

### 설계 원칙

1. **No-DAG**: 명시적 DAG 구조 강제 없음. 네이티브 Python 흐름.
2. **점진적 도입**: 복잡성과 코드 양이 함께 스케일.
3. **실패를 1등 시민으로**: 실패에 대항이 아닌 실패와 함께 작업.
4. **Decomposed Durability**: 오케스트레이션과 결과 저장 분리.
5. **State Type/Name 분리**: 오케스트레이션 로직과 시각적 표시 독립.
