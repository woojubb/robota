# Apache Airflow 서버 아키텍처 분석

**Python, 2014~**

데이터 파이프라인 오케스트레이션의 사실상 표준. 2025년 4월 Airflow 3.0 출시로 서비스 지향 아키텍처(SOA)로 대규모 전환.

## 레이어 분리

```
DAG Processor          ← DAG 파일 파싱 → JSON 직렬화 → Metadata DB 저장
  │
Scheduler              ← DAG/Task 상태 머신 운영, Executor를 통한 태스크 디스패치
  │
  ├── Executor         ← 태스크 실행 위임 (Local, Celery, Kubernetes)
  │     └── Worker     ← 실제 태스크 실행 프로세스/Pod
  │
API Server (FastAPI)   ← REST API (Public, UI, Execution API)
  │
Webserver (React)      ← UI, DB의 직렬화된 DAG만 사용
  │
Metadata DB            ← PostgreSQL/MySQL. 모든 상태 저장
  │
Triggerer (선택)       ← Deferrable Operator의 비동기 트리거 (asyncio)
```

### 컴포넌트 간 통신

| 경로 | 방식 |
|------|------|
| Scheduler ↔ Executor | 프로세스 내부 호출 |
| Scheduler ↔ Metadata DB | 직접 DB 접근 (row-level lock으로 HA) |
| Worker → API Server → DB | **Airflow 3.0**: Worker는 DB 직접 접근 불가. Task Execution API 경유 |
| DAG Processor → DB | 직접 DB 접근 (직렬화된 DAG 저장) |
| Webserver → DB | 직접 DB 접근 (읽기 전용) |

**특징**: Airflow 3.0에서 Worker의 DB 직접 접근을 제거하여 보안 경계를 강화. JWT 토큰 기반 인증으로 태스크별 격리.

## DAG/워크플로우 정의 모델

Python 코드로 정의. `DAG` 클래스 또는 `@dag` 데코레이터.

```python
@dag(schedule="@daily", start_date=datetime(2024, 1, 1))
def my_pipeline():
    @task()
    def extract():
        return data

    @task()
    def transform(data):
        return processed

    transform(extract())
```

### Airflow 3.0 DAG Versioning (AIP-63/65/66)

- 직렬화된 DAG JSON의 해시값으로 버전 산출
- DAG 구조 변경(태스크 이름, 의존성 등)이 Metadata DB에 추적
- DAG Run은 시작 시점의 DAG 버전에 바인딩 → 실행 중 새 버전이 업로드되어도 원래 버전으로 완료
- DAG Bundles (AIP-66): 번들 백엔드 구성을 DB에 저장

## 노드/태스크 모델

### BaseOperator 서브클래스

- **Operator**: 단일 태스크의 실행 로직 정의 (BashOperator, PythonOperator 등)
- **Sensor**: 외부 조건 대기 (FileSensor, HttpSensor 등)
- **TaskFlow API**: `@task` 데코레이터로 Python 함수를 태스크화. 반환값이 암묵적 XCom

### Airflow 3.0 Task SDK

- 기존 DAG과 하위 호환성 유지
- JSON 직렬화 문자열을 API 계약으로 사용 → 다중 언어 지원 기반 (Go, Java 등)
- 제공 인터페이스: Connection/Variable 접근, XCom 읽기/쓰기, Heartbeat, 로그, 메트릭

### Trigger Rules

태스크의 업스트림 의존성 판단 방식:

| 규칙 | 설명 |
|------|------|
| `all_success` (기본) | 모든 업스트림 성공 |
| `all_failed` | 모든 업스트림 실패 |
| `all_done` | 모든 업스트림 완료 (상태 무관) |
| `one_success` | 하나 이상 성공 |
| `one_failed` | 하나 이상 실패 |
| `none_skipped` | 스킵된 업스트림 없음 |
| `always` | 의존성 무시, 항상 실행 |

## 실행 모델

### Scheduling 루프

```
Scheduler.scheduling_loop()
  ├── DAG Processor가 DAG 파싱 → 직렬화 → DB 저장
  ├── Scheduler가 DB에서 DAG 로드
  ├── 스케줄 평가 → DagRun 생성 → TaskInstance 생성
  ├── 의존성 확인 → trigger_rule 평가
  ├── Executor.queue_workload() → 내부 큐에 태스크 추가
  └── Executor.sync() → 상태 동기화
```

### Executor 타입

| Executor | 실행 방식 | 적합 환경 |
|----------|-----------|-----------|
| `LocalExecutor` | Scheduler 프로세스 내 프로세스 스폰 | 소규모 배포 |
| `CeleryExecutor` | Celery 분산 큐 (RabbitMQ/Redis) | 수평 확장 |
| `KubernetesExecutor` | 태스크별 K8s Pod 생성 | 완전 격리 |
| Multi-Executor (3.0) | 쉼표 구분 다중 Executor | 혼합 워크로드 |
| Edge Executor (3.0) | 에지 디바이스 실행 | IoT/에지 |

**Airflow 3.0**: `CeleryKubernetesExecutor` 폐지 → Multi-Executor로 대체. 태스크별 `executor` 파라미터로 지정.

### Deferrable Operator (Triggerer)

- 외부 이벤트 대기 시 Worker 슬롯 점유 없이 Triggerer에 위임
- asyncio 기반 고효율 대기
- 이벤트 발생 시 태스크 재개

## 데이터 흐름

### XCom (Cross-Communication)

- 태스크 간 소규모 메타데이터 전달 메커니즘
- 식별: `key` + `task_id` + `dag_id`
- 기본: Metadata DB의 `xcom` 테이블에 JSON 직렬화 저장
- 소량 데이터 전용 설계 (대용량은 외부 Object Storage 권장)

### Push/Pull 패턴

```python
# 명시적
ti.xcom_push(key="result", value=data)
value = ti.xcom_pull(key="result", task_ids="upstream_task")

# 암시적 (TaskFlow API)
@task
def extract():
    return data  # 자동 push (key="return_value")
```

### Airflow 3.0 변경

- Worker가 DB 직접 접근 불가 → Execution API를 통해 XCom 읽기/쓰기
- JSON 포맷 문자열이 API 계약 → 언어별 Task SDK가 직렬화/역직렬화 담당
- 태스크 재시도 시 해당 태스크의 XCom 자동 삭제 (멱등성 보장)

## 상태 관리

### DagRun 상태 머신 (4 상태)

```
QUEUED ──→ RUNNING ──→ SUCCESS
                    ──→ FAILED
```

| 상태 | 설명 |
|------|------|
| `QUEUED` | 생성되어 실행 대기 |
| `RUNNING` | 태스크 인스턴스 실행 중 |
| `SUCCESS` | 모든 리프 노드가 success 또는 skipped |
| `FAILED` | 하나 이상의 리프 노드가 failed 또는 upstream_failed |

### TaskInstance 상태 머신 (12 상태, 5 터미널)

```
[none] → SCHEDULED → QUEUED → RUNNING → SUCCESS ✓
                                       → FAILED → UP_FOR_RETRY → SCHEDULED (재시도)
                                       → FAILED ✓ (재시도 소진)
                                       → RESTARTING → SCHEDULED
                              → DEFERRED → (Triggerer) → SCHEDULED
                     → UPSTREAM_FAILED ✓
                     → SKIPPED ✓
                     → REMOVED ✓
           → UP_FOR_RESCHEDULE → SCHEDULED (센서 reschedule)
```

**터미널 상태 (5개)**: `SUCCESS`, `FAILED`, `SKIPPED`, `UPSTREAM_FAILED`, `REMOVED`

**중간 상태 (6개)**: `SCHEDULED`, `QUEUED`, `RESTARTING`, `UP_FOR_RETRY`, `UP_FOR_RESCHEDULE`, `DEFERRED`

**Robota 대비 특이점**:
- `DEFERRED` 상태 (Triggerer 위임)
- `UP_FOR_RETRY` / `UP_FOR_RESCHEDULE` 중간 상태 (Robota는 `failed → queued` 직접 전이)
- `REMOVED` 상태 (DAG 구조 변경 시)
- `RESTARTING` 상태 (Worker 교체 시)

## 스토리지/영속성

관계형 DB (PostgreSQL 권장, MySQL 지원):

| 테이블 | 내용 |
|--------|------|
| `dag` | 직렬화된 DAG JSON |
| `dag_run` | DAG 실행 인스턴스 |
| `task_instance` | 태스크 실행 인스턴스 |
| `xcom` | 태스크 간 데이터 |
| `variable` | 전역 변수 |
| `connection` | 외부 시스템 연결 정보 |
| `log` | 실행 로그 |

**Scheduler HA**: row-level lock (`SELECT ... FOR UPDATE`)으로 동시성 제어. PGBouncer 연결 풀링 권장.

## 서버 API

### Airflow 3.0 API 표면 분리

| API | 경로 | 안정성 | 용도 |
|-----|------|--------|------|
| Public API | `/api/v2` | Semantic Versioning | 외부 통합, CI/CD |
| UI API | `/ui` | Breaking change 가능 | React 프론트엔드 전용 |
| Execution API | `/execution/*` | 내부 전용 | Task SDK ↔ API Server |

### 기술 스택

- **FastAPI** 기반 (Airflow 3.0에서 Flask → FastAPI 전환)
- **Pydantic** 모델로 요청/응답 검증 (자동 camelCase alias)
- OpenAPI 스펙에서 TypeScript 타입 자동 생성

### 공통 패턴

- 페이지네이션: `limit`(기본 50) / `offset`
- 필터링: SQL LIKE 패턴, 범위 필터 (`_gte`, `_gt`, `_lte`, `_lt`)
- 벌크 연산: Discriminated Union, 성공/실패 개별 추적
- 인증: OAuth2 / HTTPBearer, `@requires_access_dag` DAG별 권한

### Execution API (AIP-72)

Airflow 3.0의 핵심 변경:

- `GET /execution/task-instances/{ti_id}/start` — 태스크 컨텍스트 조회
- `PATCH /execution/task-instances/{ti_id}/state` — 상태 업데이트
- JWT 토큰: 각 태스크 시도에 발급, 타원 곡선 서명
- Push/Pull: 로컬(Push, 빠름) vs 원격(Pull, 네트워크 경계)

## 이벤트/진행 보고

- Webserver가 DB 폴링하여 UI 갱신
- Airflow 3.0: React 기반 UI 도입
- 실시간 스트리밍 프로토콜(WebSocket/SSE) 없음 → 폴링 기반
- 태스크 로그는 Worker에서 생성, API Server를 통해 조회

## 에러 처리 & 재시도

### 재시도 설정

| 파라미터 | 설명 |
|----------|------|
| `retries` | 최대 재시도 횟수 |
| `retry_delay` | 재시도 간 대기 시간 |
| `retry_exponential_backoff` | 지수 백오프 활성화 |
| `max_retry_delay` | 최대 재시도 지연 |

### 특수 예외

| 예외 | 동작 |
|------|------|
| `AirflowException` | 일반 실패, 재시도 트리거 |
| `AirflowFailException` | 즉시 실패 (남은 재시도 무시) |
| `AirflowSkipException` | 태스크 스킵 |
| `TaskDeferred` | Triggerer로 위임 |

### 콜백

- `on_failure_callback` — 실패 시 (알림, 정리)
- `on_retry_callback` — 재시도 시
- `on_success_callback` — 성공 시
- `sla_miss_callback` — SLA 위반 시

### 재시도 흐름

```
RUNNING → FAILED → (retries 남음?) → UP_FOR_RETRY → SCHEDULED → QUEUED → RUNNING
                 → (retries 소진) → FAILED (터미널)
```

## 캐싱

### DAG 직렬화 캐싱

- DAG Processor가 파싱 → JSON 직렬화 → DB 저장
- Webserver는 파일 파싱 없이 DB에서 직렬화된 DAG 로드
- 온디맨드 로드: 요청 시 개별 DAG 로드 (전체 DagBag 로드 회피)

| 설정 | 설명 |
|------|------|
| `min_serialized_dag_fetch_interval` | DB 재조회 주기 (높으면 DB 부하↓, stale↑) |
| `compress_serialized_dags` | 대규모 DAG 압축 저장 |
| `min_serialized_dag_update_interval` | 직렬화 DAG 업데이트 최소 주기 |

### 실행 결과 캐싱

없음. 매 실행마다 전체 수행. XCom은 실행 결과 전달용이지 캐싱용이 아님.

## 특이점

### Airflow 3.0 아키텍처 전환 (2025.04)

1. **Task Execution API**: Worker의 DB 직접 접근 제거 → API 경유. 보안 경계 강화.
2. **Task SDK**: 다중 언어 지원 기반. JSON 직렬화 계약.
3. **DAG Versioning**: 해시 기반 버전 추적. 실행 중 DAG 변경 격리.
4. **Multi-Executor**: 태스크별 Executor 지정. 혼합 워크로드 지원.
5. **Data Assets**: Dataset → Data Assets 진화. Common Message Bus 기반 외부 이벤트 트리거.
6. **FastAPI 전환**: Flask → FastAPI. Pydantic 검증, 자동 문서 생성.

### 설계 철학

- **Configuration as Code**: Python 코드로 DAG 정의 (YAML/JSON 아님)
- **Extensibility**: Operator/Hook/Executor 플러그인 시스템
- **Observability**: 모든 상태 전이가 DB에 기록, UI에서 추적 가능
- **Scale**: Scheduler HA, 분산 Executor, K8s 네이티브 지원
