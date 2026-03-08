# 아키텍처 비교 대조표

5개 오픈소스 DAG/워크플로우 솔루션과 Robota DAG의 서버 사이드 구현을 11개 축으로 비교한다.

## 1. 레이어 분리

| 솔루션 | 레이어 구성 | 분리 방식 |
|--------|-----------|-----------|
| **Airflow** | Scheduler / DAG Processor / API Server / Webserver / Executor / Worker / Triggerer / Metadata DB | 프로세스 단위 분리. Airflow 3.0에서 Worker의 DB 직접 접근 제거 (SOA 전환) |
| **ComfyUI** | PromptServer / PromptQueue / PromptExecutor / DynamicPrompt / ExecutionList / CacheSet / Node Registry / Model Manager | 암묵적 분리. 단일 프로세스. 포트/어댑터 없음. GPU 메모리 관리가 핵심 |
| **Dagster** | Webserver / Daemon (4 서브데몬) / Code Location Server / Run Worker / Storage (3 스토어) | 프로세스 단위. gRPC 통신. 관심사별 명확한 분리. 플러그형 구성 |
| **Prefect** | API Server / Orchestration Engine / Database / Work Pool / Worker / Task Runner / Result Store | 클라이언트-서버 분리. Task 오케스트레이션은 클라이언트 사이드. 결과 저장 분리 |
| **n8n** | CLI Server / WorkflowRunner / WorkflowExecute / ScalingService / NodeTypes Registry / Push Service | TypeScript 모노레포. Regular(인프로세스) vs Queue(Bull+Redis) 이중 모드 |
| **Robota** | dag-core / dag-runtime / dag-worker / dag-scheduler / dag-projection / dag-api / dag-server-core / dag-nodes / dag-designer | **9개 npm 패키지**로 세분화. 포트/어댑터 패턴. 인프라 교체 가능 |

**비교 분석**: Robota는 가장 세분화된 패키지 분리를 보유. Airflow/Dagster는 프로세스 레벨, ComfyUI/n8n은 모듈 레벨 분리. Robota의 포트/어댑터 패턴은 Dagster의 플러그형 구성과 유사하나, 패키지 경계가 더 명확.

## 2. DAG/워크플로우 정의 모델

| 솔루션 | 정의 방식 | 버전 관리 |
|--------|----------|-----------|
| **Airflow** | Python 코드 (DAG 클래스, @task 데코레이터) | 3.0: DAG JSON 해시 기반 버전 추적 |
| **ComfyUI** | JSON 워크플로우 (UI 편집 → JSON 직렬화) | 없음. 제출 시 즉시 실행 |
| **Dagster** | Python 코드 (@asset, @op 데코레이터). Asset Graph 자동 추론 | Code version + Data version 추적 |
| **Prefect** | Python 코드 (@flow, @task). 네이티브 Python 제어 흐름 | 없음 (코드 기반) |
| **n8n** | JSON 워크플로우 (UI 편집) | 없음. 저장 = 활성 |
| **Robota** | IDagDefinition JSON (UI 편집 → JSON 직렬화) | version 필드 + draft/published/archived 상태 |

**비교 분석**: Robota는 ComfyUI/n8n과 같은 JSON 정의 방식이지만, 명시적 버전 관리와 상태 라이프사이클(draft→published→archived)을 제공. Airflow 3.0의 DAG 버전 추적이나 Dagster의 code_version과 접근이 유사.

## 3. 노드/태스크 모델

| 솔루션 | 정의 방식 | 타입 시스템 | 라이프사이클 |
|--------|----------|-----------|------------|
| **Airflow** | BaseOperator 서브클래스, @task 데코레이터 | 없음 (Python 동적 타이핑) | execute() 단일 메서드 |
| **ComfyUI** | Python 클래스 + NODE_CLASS_MAPPINGS 등록 | 문자열 기반 (MODEL, IMAGE 등) | FUNCTION 단일 메서드. Lazy 입력 지원 |
| **Dagster** | @asset, @op 데코레이터 | DagsterType 런타임 검증 | compute_fn 단일 함수 |
| **Prefect** | @task 데코레이터 | Python 타입 힌트 (런타임 검증 없음) | 함수 호출 |
| **n8n** | INodeType 인터페이스 (execute/supplyData) | JSON Schema 기반 파라미터 | execute() 단일 메서드 |
| **Robota** | AbstractNodeDefinition\<TSchema\> 추상 클래스 | Zod 스키마 + TPortValueType | **6개 라이프사이클 훅** (initialize → validateInput → estimateCost → execute → validateOutput → dispose) |

**비교 분석**: Robota만 6단계 라이프사이클을 제공. 특히 `estimateCost`는 다른 솔루션에 없는 고유 기능. `validateInput`/`validateOutput` 단계도 ComfyUI의 Lazy evaluation과 다른 접근.

## 4. 실행 모델

| 솔루션 | 그래프 순회 | 디스패치 | 병렬/분산 |
|--------|-----------|---------|----------|
| **Airflow** | Scheduler 스케줄 루프 | Executor 플러그인 (Local/Celery/K8s) | Executor별 분산 전략. Multi-Executor (3.0) |
| **ComfyUI** | Kahn 알고리즘 위상정렬 | 단일 데몬 스레드 | 단일 프로세스, 순차 실행 (GPU 공유) |
| **Dagster** | 실행 계획(Execution Plan) 순회 | Executor 플러그인 (multiprocess/Celery/K8s) | Executor별 분산. Step 단위 격리 |
| **Prefect** | 동적 (네이티브 Python 흐름) | Task Runner (Thread/Process/Dask/Ray) | Task Runner별 분산 |
| **n8n** | 스택 기반 (v0: BFS/LIFO, v1: DFS/FIFO) | Regular(인프로세스) / Queue(Bull+Redis) | Queue 모드: 워커 수평 확장 |
| **Robota** | 엔트리 노드 → 하류 ready 체크 → 순차 디스패치 | IQueuePort → WorkerLoopService | IQueuePort 추상화. 현재 단일 프로세스 |

**비교 분석**: Robota는 포트 추상화로 분산 확장 기반을 갖추었으나, 현재 InMemoryQueuePort만 존재. n8n의 Bull Queue나 Airflow의 Celery처럼 프로덕션급 큐 어댑터가 필요.

## 5. 데이터 흐름

| 솔루션 | 전달 방식 | 바이너리 | 특이사항 |
|--------|----------|---------|---------|
| **Airflow** | XCom (DB 저장, 소량 메타데이터) | Object Storage 권장 | TaskFlow API로 암묵적 XCom. 대용량 부적합 |
| **ComfyUI** | 메모리 직접 전달 (PyTorch 텐서) | 텐서 형태로 메모리 내 전달 | 단일 프로세스이므로 직렬화 불필요 |
| **Dagster** | IO Manager (저장/로딩 추상화) | IO Manager가 처리 | 비즈니스 로직과 I/O 분리. 환경별 교체 |
| **Prefect** | 함수 반환값 (Python 네이티브) | Result Store (S3/GCS/로컬) | "Decomposed Durability" — 결과와 메타데이터 분리 |
| **n8n** | INodeExecutionData\[\]\[\] (JSON + binary ref) | 파일시스템/S3 참조 | pairedItem으로 아이템 레벨 리니지 추적 |
| **Robota** | TPortPayload (Record\<string, TPortValue\>) | IPortBinaryValue (kind, mimeType, uri, assetId) | 엣지 바인딩 (outputKey → inputKey). AssetAwareTaskExecutorPort 데코레이터 |

**비교 분석**: Robota의 엣지 바인딩은 포트 키 기반으로 ComfyUI의 인덱스 기반이나 n8n의 연결 맵보다 명시적. AssetAwareTaskExecutorPort 데코레이터 패턴은 Dagster IO Manager와 유사한 관심사 분리.

## 6. 상태 관리

| 솔루션 | Run 상태 | Task 상태 | 상태 머신 |
|--------|---------|----------|----------|
| **Airflow** | 4: QUEUED→RUNNING→SUCCESS/FAILED | 12: 5 터미널 + 6 중간 + RUNNING | 명시적 (trigger_rule 기반 전이) |
| **ComfyUI** | 없음 | 없음 | 암묵적 (WebSocket 이벤트 시퀀스) |
| **Dagster** | 9: NOT_STARTED→QUEUED→STARTING→STARTED→SUCCESS/FAILURE/CANCELED | Step 이벤트 로그 기반 (별도 상태 머신 없음) | Run 레벨만 명시적 |
| **Prefect** | 9: SCHEDULED→PENDING→RUNNING→COMPLETED/FAILED/CANCELLED/CRASHED | Flow/Task 동일 상태 타입 | OrchestrationRule 체인 기반 전이 검증 |
| **n8n** | 4: new→running→success/error/canceled (+waiting) | 없음 (노드별 실행 결과만 저장) | 없음 |
| **Robota** | 6: created→queued→running→success/failed/cancelled | 8: 5 터미널 + created/queued/running. failed→queued 재시도 | **명시적 FSM** (DagRunStateMachine, TaskRunStateMachine) |

**비교 분석**: Robota는 Airflow와 유사하게 명시적 상태 머신을 제공하지만, 더 간결. Robota의 `failed→queued` 재시도 전이는 Airflow의 `FAILED→UP_FOR_RETRY→SCHEDULED` 3단계보다 직접적. Prefect의 State Type/Name 분리는 Robota에 없는 개념.

## 7. 스토리지/영속성

| 솔루션 | 메타데이터 | 실행 결과 | 프로덕션 백엔드 |
|--------|----------|----------|--------------|
| **Airflow** | 관계형 DB (runs, tasks, XComs, variables) | XCom 또는 Object Storage | PostgreSQL/MySQL |
| **ComfyUI** | 인메모리 히스토리 | 파일시스템 (출력 이미지) | 없음 (서버 재시작 시 유실) |
| **Dagster** | 3 분리 스토어 (Run/Event Log/Schedule) + 비정규화 캐시 | IO Manager가 관리 | PostgreSQL (LISTEN/NOTIFY) |
| **Prefect** | 관계형 DB (Flow/Task runs, deployments) | Result Store (S3/GCS/로컬) 분리 | PostgreSQL |
| **n8n** | TypeORM (워크플로우, 실행, 자격증명) | DB + 파일시스템/S3 (바이너리) | PostgreSQL |
| **Robota** | IStoragePort (추상) | IStoragePort + IAssetStore | **현재: FileStoragePort (정의만 파일, 런/태스크 인메모리)** |

**비교 분석**: Robota의 IStoragePort 추상화는 우수하나, 프로덕션급 구현체(PostgreSQL)가 부재. Dagster의 3스토어 분리나 Prefect의 메타데이터/결과 분리가 참고할 패턴.

## 8. 서버 API

| 솔루션 | API 유형 | 기술 스택 | 문서화 |
|--------|---------|----------|--------|
| **Airflow** | REST (3 표면: Public/UI/Execution) | FastAPI + Pydantic | OpenAPI 자동 생성 |
| **ComfyUI** | REST + WebSocket | aiohttp | 없음 (비공식) |
| **Dagster** | GraphQL (주) + REST (보조) | Python Graphene | Schema-first (75K+ 라인) |
| **Prefect** | REST | FastAPI | OpenAPI |
| **n8n** | REST | Express + @RestController 데코레이터 | Swagger |
| **Robota** | REST + SSE | Express | OpenAPI 3.0.3 + Swagger UI |

**비교 분석**: Robota는 n8n과 유사한 Express + REST 구조에 SSE를 추가. Dagster의 GraphQL은 유연하지만 복잡. Airflow 3.0의 API 표면 분리(Public/UI/Execution)는 참고할 패턴.

## 9. 이벤트/진행 보고

| 솔루션 | 프로토콜 | 실시간성 | 이벤트 타입 |
|--------|---------|---------|-----------|
| **Airflow** | DB 폴링 | 낮음 | Run/Task 상태 변경 |
| **ComfyUI** | WebSocket 양방향 | 높음 | status, executing, progress, executed 등 8종. 바이너리 프리뷰 |
| **Dagster** | Event Log (append-only) + 폴링/LISTEN-NOTIFY | 중간 | 130+ 이벤트 타입 (DagsterEventType) |
| **Prefect** | Events + Automations | 중간 | 리소스+액션 문법. Webhooks 통합 |
| **n8n** | WebSocket/SSE (선택) | 높음 | sendChunk API: begin, end, node-execute-*, error, tool-call-* |
| **Robota** | SSE (Server-Sent Events) | 높음 | TRunProgressEvent: execution.started/completed/failed, task.started/completed/failed |

**비교 분석**: Robota의 SSE 이벤트는 ComfyUI/n8n의 WebSocket과 유사한 실시간성. 다만 이벤트 타입이 6종으로 Dagster(130+)나 ComfyUI(8종+바이너리)보다 적음. 프로그레스 퍼센티지(ComfyUI의 progress 이벤트) 같은 세분화 여지.

## 10. 에러 처리 & 재시도

| 솔루션 | 에러 모델 | 재시도 | DLQ | 특이사항 |
|--------|----------|--------|-----|---------|
| **Airflow** | 예외 기반 (특수 예외 클래스 분기) | retries + delay + exponential backoff | 없음 | on_failure/retry/success 콜백 |
| **ComfyUI** | 없음 (실패 시 중단) | 없음 | 없음 | /interrupt로 수동 중단만 |
| **Dagster** | 이벤트 기반 (RetryRequested 예외) | RetryPolicy (max, delay, backoff, jitter) | 없음 | Op Retry vs Run Retry 분리 |
| **Prefect** | 상태 기반 (OrchestrationRule) | retries + retry_delay_seconds | 없음 | "Negative Engineering" — 실패를 1등 시민으로 |
| **n8n** | 예외 기반 + continueOnFail | Retry on Fail (노드별) | 없음 | Error Workflow. AbortController 취소 |
| **Robota** | **TResult\<T,E\> 패턴** (No Fallback) | attempt 증가 → 재큐잉 (maxAttempts) | **DLQ 지원** (DlqReinjectService) | IDagError 분류 체계 (5 카테고리) |

**비교 분석**: Robota는 **유일하게 DLQ를 지원**하는 솔루션. Result<T,E> 패턴도 다른 모든 솔루션(예외 기반)과 차별화. IDagError의 카테고리 분류와 retryable 플래그는 Airflow/Dagster의 특수 예외보다 체계적.

## 11. 캐싱

| 솔루션 | 캐싱 전략 | 캐시 키 | 무효화 |
|--------|----------|--------|--------|
| **Airflow** | 없음 (DAG 직렬화 캐싱만) | - | - |
| **ComfyUI** | **4가지 전략** (CLASSIC, LRU, RAM_PRESSURE, NONE) | 입력 시그니처 해시 | 전략별 (조상 변경, LRU, 메모리 압력) |
| **Dagster** | Memoization (코드 버전 + 데이터 버전) | code_version + input data versions 해시 | 코드/데이터 버전 변경 시 |
| **Prefect** | Cache Policy (DEFAULT, INPUTS, TASK_SOURCE 등) | 정책별 (입력, 코드, flow 파라미터) | cache_expiration 만료 |
| **n8n** | 없음 | - | - |
| **Robota** | **없음** | - | - |

**비교 분석**: Robota는 n8n/Airflow와 함께 실행 결과 캐싱이 없음. ComfyUI의 4단계 전략, Dagster의 버전 기반 memoization, Prefect의 Cache Policy가 참고 모델. 특히 ComfyUI의 입력 시그니처 기반 캐시는 Robota의 노드 모델에 적용 가능한 패턴.

---

## 종합 포지셔닝

```
            단순함                                    복잡함
              │                                        │
    ComfyUI ──┼── n8n ──── Prefect ──── Robota ──── Dagster ── Airflow
              │                                        │
          단일 프로세스            포트/어댑터           프로세스 분산
          GPU 특화               DI 기반                플러그형 구성
          실시간 중심            Result 패턴             이벤트 소싱
```

**Robota의 고유 위치**:
- 아키텍처 추상화(포트/어댑터, 패키지 분리)는 Dagster/Airflow급
- 에러 모델링(Result<T,E>, DLQ, IDagError)은 비교 대상 중 가장 체계적
- 노드 라이프사이클(6훅, 비용 추정)은 고유 기능
- 분산 실행, 캐싱, 프로덕션 스토리지는 성숙도 보강 필요
