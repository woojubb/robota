# 비교 분석 및 갭 평가 (드래프트)

Phase 1의 벤치마킹 리서치를 바탕으로 Robota DAG 구현의 강점과 잠재적 개선 영역을 분석한다.
이 문서는 드래프트이며, 기존 SPEC.md를 변경하지 않는다.

## 강점 요약

### 1. 아키텍처 추상화 수준 — 최상위

Robota의 9개 패키지 분리와 포트/어댑터 패턴은 비교 대상 중 가장 세분화된 구조.

- **Dagster**: 프로세스 레벨 분리 + 플러그형 구성. 유사한 수준이지만 npm 패키지 경계 없음.
- **Airflow 3.0**: SOA 전환으로 접근하지만, 단일 코드베이스 내 모듈 분리.
- **Robota**: 각 레이어가 독립 npm 패키지로 빌드/테스트/배포 가능. 의존성 방향이 엄격.

### 2. 에러 모델링 — 가장 체계적

- `TResult<T,E>` 패턴: 모든 도메인 함수에 적용. 비교 대상 전부 예외 기반.
- `IDagError` 분류: 5개 카테고리 + retryable 플래그. Airflow/Dagster의 특수 예외보다 체계적.
- **DLQ 지원**: 비교 대상 중 유일. `DlqReinjectService`로 수동 재투입까지 지원.
- No Fallback Policy: 대체 경로 없이 실패를 명시적으로 처리.

### 3. 노드 라이프사이클 — 고유 기능

6개 훅(initialize → validateInput → estimateCost → execute → validateOutput → dispose)은 비교 대상 중 가장 풍부.

- `estimateCost`: 실행 전 비용 추정 + `RunCostPolicyEvaluator`로 예산 관리. 다른 솔루션에 없는 기능.
- `validateInput`/`validateOutput`: Dagster의 런타임 타입 검증과 유사하지만 라이프사이클 단계로 격리.

### 4. 명시적 상태 머신

`DagRunStateMachine`과 `TaskRunStateMachine`은 유효 전이를 테이블로 인코딩.

- Airflow는 유사한 접근이지만 12개 상태로 복잡.
- ComfyUI/n8n은 상태 머신 없음.
- Robota의 `failed→queued` 재시도 전이는 Airflow의 3단계(FAILED→UP_FOR_RETRY→SCHEDULED)보다 직접적이고 명확.

### 5. 자산 관리

`IAssetStore` + `AssetAwareTaskExecutorPort` 데코레이터 패턴은 바이너리 데이터를 일급 시민으로 관리.

- Dagster IO Manager와 유사한 관심사 분리.
- ComfyUI의 파일시스템 직접 저장이나 n8n의 바이너리 참조보다 추상화 수준이 높음.

### 6. 서버 권위적 실행

dag-designer는 API 호출만 수행. 실행 로직이 클라이언트에 없음.

- Prefect는 반대로 Task 오케스트레이션을 클라이언트 사이드에서 처리.
- ComfyUI도 클라이언트는 제출만 하는 유사한 패턴.

---

## 잠재적 개선 영역

### GAP-1: 캐싱 전략 부재

**현황**: 매 실행마다 전체 수행. 캐싱 메커니즘 없음.

**벤치마크 참고**:
- ComfyUI: 4단계 전략 (CLASSIC, LRU, RAM_PRESSURE, NONE). 입력 시그니처 기반 캐시 키.
- Dagster: code_version + data_version 해싱으로 memoization. 버전 변경 시만 재실행.
- Prefect: Cache Policy 합성 가능. INPUTS, TASK_SOURCE, FLOW_PARAMETERS 등 조합.

**개선 방향 (드래프트)**:
- 입력 페이로드 해시 기반 캐시 키 생성
- 노드 매니페스트에 `cacheable: boolean` 플래그 추가
- `IExecutionCachePort` 인터페이스 정의 (포트/어댑터 패턴 유지)
- 기존 `execution-caching` 스킬 참조하여 정책 설계

### GAP-2: 프로덕션 스토리지 구현체 부재

**현황**: `FileStoragePort`는 정의만 파일 저장, 런/태스크는 인메모리. 서버 재시작 시 실행 데이터 유실.

**벤치마크 참고**:
- Airflow/Dagster/Prefect/n8n: 모두 PostgreSQL을 프로덕션 백엔드로 제공.
- Dagster: 3가지 분리된 스토어 (Run/Event Log/Schedule). append-only 이벤트 로그 + 비정규화 캐시.
- Prefect: "Decomposed Durability" — 메타데이터(DB)와 결과(Object Store) 분리.

**개선 방향 (드래프트)**:
- `PostgresStoragePort` 구현 (IStoragePort 어댑터)
- Dagster의 3스토어 분리 참고하여 Definition/Run/TaskRun 저장소 분화 검토
- Prefect의 메타데이터/결과 분리 패턴 검토

### GAP-3: 분산 워커 구조 미구현

**현황**: `InMemoryQueuePort`만 존재. 단일 프로세스 내 실행.

**벤치마크 참고**:
- Airflow: Executor 플러그인 (Celery, Kubernetes). Multi-Executor (3.0).
- Dagster: Executor 플러그인 (multiprocess, Celery, Docker, K8s).
- n8n: Bull Queue + Redis. Regular(인프로세스) vs Queue(분산) 이중 모드.
- Prefect: Work Pool + Worker 모델. Push/Pull 패턴.

**개선 방향 (드래프트)**:
- `BullMQQueuePort` 또는 `RedisQueuePort` 구현 (IQueuePort 어댑터)
- n8n의 이중 모드(Regular/Queue) 참고 — 개발 시 인메모리, 프로덕션 시 분산 큐
- `ILeasePort`의 Redis 기반 구현 (분산 락)
- 워커 프로세스 분리 및 스케일링 전략

### GAP-4: 스케줄러 자체 폴링 루프 부재

**현황**: `SchedulerTriggerService`는 외부 트리거 방식. 자체 폴링 루프 없음.

**벤치마크 참고**:
- Airflow: Scheduler가 DAG 파싱 → 스케줄 평가 → TaskInstance 생성을 자율적으로 수행.
- Dagster: Daemon의 Scheduler/Sensor 서브데몬이 주기적 폴링.
- Prefect: Work Pool에서 Worker가 능동적 폴링.

**개선 방향 (드래프트)**:
- `SchedulerLoopService` — 주기적 스케줄 평가 + 런 생성 루프
- 크론 표현식 기반 스케줄 정의 (`IDagDefinition.schedule` 필드)
- Dagster의 Sensor 패턴 참고 — 외부 조건 감시 기반 트리거

### GAP-5: 이벤트 타입 세분화

**현황**: 6종의 `TRunProgressEvent` (execution.started/completed/failed, task.started/completed/failed).

**벤치마크 참고**:
- ComfyUI: 8종 + progress(진행률) + 바이너리 프리뷰. 노드별 실시간 프로그레스.
- Dagster: 130+ 이벤트 타입. Asset materialization, 타입 체크, 데이터 품질 등.
- n8n: sendChunk API — begin, end, node-execute-before/after, tool-call-start/end.

**개선 방향 (드래프트)**:
- `task.progress` 이벤트 추가 (진행률 보고 — value/max)
- `task.cost_estimated` 이벤트 (비용 추정 결과 실시간 보고)
- `dag.validation_completed` 이벤트 (검증 결과 보고)
- 노드 라이프사이클 단계별 이벤트 (initialize, validateInput 등)

### GAP-6: 이벤트 영속성

**현황**: `RunProgressEventBus`가 인메모리 pub/sub. 이벤트 영속 저장 없음.

**벤치마크 참고**:
- Dagster: append-only 이벤트 로그가 모든 실행 기록의 SSOT. 130+ 이벤트를 영속 저장.
- Prefect Cloud: ClickHouse 기반 이벤트 저장.

**개선 방향 (드래프트)**:
- `IEventLogPort` 인터페이스 정의
- Dagster의 append-only 이벤트 로그 패턴 참고
- 기존 IStoragePort와 분리하여 이벤트 전용 스토어 운영

### GAP-7: 조건부 실행 / 분기 제어

**현황**: 노드 의존성은 `dependsOn` 배열로 정의. 조건부 실행(if/else), 루프, 스킵 조건 등 명시적 제어 흐름 없음.

**벤치마크 참고**:
- Airflow: trigger_rule (all_success, one_failed, always 등 7종). skipped 전파.
- ComfyUI: ExecutionBlocker + Lazy evaluation. check_lazy_status()로 조건부 평가.
- Prefect: 네이티브 Python 제어 흐름 (if/else, for, while 직접 사용).
- n8n: IF 노드, Switch 노드. continueOnFail로 에러 분기.

**개선 방향 (드래프트)**:
- `IDagNode.triggerRule` 필드 추가 (Airflow 참고: all_success, any_success, all_done 등)
- 조건부 엣지: `IDagEdgeDefinition.condition` 필드 (출력값 기반 분기)
- ComfyUI의 ExecutionBlocker 패턴 참고 — 실행 차단 전파

---

## 개선 영역 우선순위 (제안)

| 우선순위 | 영역 | 근거 |
|---------|------|------|
| 1 | GAP-2: 프로덕션 스토리지 | 서버 재시작 시 데이터 유실은 프로덕션 배포의 전제 조건 |
| 2 | GAP-3: 분산 워커 | 단일 프로세스는 처리량 병목. IQueuePort가 이미 추상화되어 구현만 필요 |
| 3 | GAP-1: 캐싱 전략 | AI 노드(LLM, 이미지 생성)의 높은 비용을 고려하면 캐싱은 비용 절감의 핵심 |
| 4 | GAP-4: 스케줄러 루프 | 자동화된 워크플로우 실행에 필수. 현재 외부 트리거 의존 |
| 5 | GAP-7: 조건부 실행 | 복잡한 워크플로우 정의에 필요. 현재 모든 의존 노드가 무조건 실행 |
| 6 | GAP-5: 이벤트 세분화 | UX 개선. 현재 이벤트로도 기본 추적 가능 |
| 7 | GAP-6: 이벤트 영속성 | 감사/디버깅 강화. 현재 projection으로 부분 대체 가능 |

---

## 포트/어댑터 패턴의 전략적 가치

벤치마킹을 통해 확인된 가장 중요한 발견:

**Robota의 포트/어댑터 아키텍처는 GAP-1~3 해소를 저비용으로 가능하게 한다.**

- GAP-1 (캐싱): `IExecutionCachePort` 인터페이스 추가 → 어댑터 구현
- GAP-2 (스토리지): `IStoragePort`의 PostgreSQL 어댑터 구현
- GAP-3 (분산 큐): `IQueuePort` + `ILeasePort`의 Redis/BullMQ 어댑터 구현

이 세 가지 모두 기존 도메인 로직(dag-core, dag-runtime, dag-worker)의 변경 없이 어댑터만 추가하면 된다. Airflow/Dagster가 수년에 걸쳐 리팩토링한 인프라 교체를 Robota는 설계 시점부터 준비한 것.

반면, GAP-4(스케줄러 루프)와 GAP-7(조건부 실행)은 도메인 로직 변경이 필요하여 상대적으로 비용이 높다.

---

## 다음 단계

이 드래프트의 개선 방향은 제안 수준이며, 실제 적용 시:

1. 각 GAP에 대한 상세 설계 문서 작성 (ADR 형식)
2. 관련 SPEC.md 변경 사항 제안
3. 사용자 승인 후 구현 진행
