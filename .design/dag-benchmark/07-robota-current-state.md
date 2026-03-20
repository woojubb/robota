# Robota DAG 현황 정리

**TypeScript, 2024~**

## 레이어 분리

9개 패키지로 세분화된 레이어 구조. 포트/어댑터(Hexagonal) 패턴 기반.

```
dag-core          ← 도메인 계약 SSOT (타입, 상태 머신, 포트, 에러)
  ↓
dag-runtime       ← 런 오케스트레이션 (생성, 상태 전이, 엔트리 디스패치)
dag-worker        ← 태스크 실행 루프 (dequeue, lease, 실행, 하류 디스패치)
dag-projection    ← 읽기 모델 (런/리니지/대시보드 프로젝션)
  ↓
dag-scheduler     ← 스케줄 평가, 배치 트리거, Catchup
  ↓
dag-api           ← 컨트롤러 조합 (Design, Runtime, Observability, Diagnostics)
  ↓
dag-server-core   ← Express 서버 부트스트랩, 파일 스토리지, 자산 관리
dag-nodes         ← 구체 노드 구현 (11개)
dag-designer      ← React UI 클라이언트
```

**Import 방향**: 모든 패키지가 `dag-core` 방향으로 import. 역방향 의존성 없음.

**특징**:
- 각 레이어가 독립 패키지로 분리되어 있어 교체/테스트 용이
- dag-runtime, dag-worker, dag-projection이 dag-core만 의존 (sibling 독립)
- dag-api가 조합 레이어 역할 (모든 실행 패키지를 wiring)

## DAG/워크플로우 정의 모델

`IDagDefinition` JSON 구조:

```typescript
interface IDagDefinition {
  dagId: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  nodes: IDagNode[];
  edges: IDagEdgeDefinition[];
  metadata?: IDagMetadata;
}
```

- UI(dag-designer)에서 편집 → JSON 직렬화
- `draft → published → archived` 라이프사이클
- 실행 시점에 definition snapshot을 JSON 문자열로 저장 (불변성 보장)

## 노드/태스크 모델

### 노드 정의

`AbstractNodeDefinition<TSchema>` 추상 클래스 기반:

```typescript
abstract class AbstractNodeDefinition<TSchema> implements INodeLifecycle {
  // Zod를 통한 config 파싱 → *WithConfig 메서드로 위임
  abstract executeWithConfig(input, context, config): Promise<TResult<INodeExecutionResult, IDagError>>;
  abstract estimateCostWithConfig(input, context, config): Promise<TResult<ICostEstimate, IDagError>>;
  // optional: initializeWithConfig, validateInputWithConfig, validateOutputWithConfig, disposeWithConfig
}
```

### 6개 라이프사이클 훅

1. `initialize(context)` — 초기화 (optional)
2. `validateInput(input, context)` — 입력 포트 검증 (optional, 기본 검증 포함)
3. `estimateCost(input, context)` — 비용 추정 (required)
4. `execute(input, context)` — 핵심 실행 (required)
5. `validateOutput(output, context)` — 출력 포트 검증 (optional, 기본 검증 포함)
6. `dispose(context)` — 정리 (optional)

### 노드 등록

`INodeManifest`로 메타데이터 등록. `INodeManifestRegistry` / `INodeLifecycleFactory`로 조회 및 인스턴스 생성.

### 구체 노드 (11개)

| 노드 | 역할 |
|------|------|
| InputNode | DAG 입력 진입점 |
| TextOutputNode | 텍스트 출력 싱크 |
| TextTemplateNode | 문자열 템플릿 보간 |
| ImageSourceNode | 이미지 소스/업로드 |
| ImageLoaderNode | 이미지 참조 로딩 |
| TransformNode | 범용 데이터 변환 |
| OkEmitterNode | 항상 성공 (테스트용) |
| LlmTextOpenAiNode | OpenAI 텍스트 생성 |
| GeminiImageEditNode | Gemini 이미지 편집 |
| GeminiImageComposeNode | Gemini 이미지 합성 |
| SeedanceVideoNode | Seedance 비디오 생성 |

## 실행 모델

### 오케스트레이션 흐름

```
RunOrchestratorService.startRun()
  ├── Definition 유효성 검증 (published 상태 확인)
  ├── 멱등성 키 검증: {dagId}:{logicalDate}[:rerun:{rerunKey}]
  ├── DagRun 생성 (created → queued → running)
  ├── 엔트리 노드 식별 (dependsOn이 빈 노드)
  ├── TaskRun 생성 + 큐 메시지 발행
  └── 진행 이벤트 발행
```

### 워커 루프

```
WorkerLoopService.processOnce()
  ├── IQueuePort.dequeue() — 가시성 타임아웃 적용
  ├── ILeasePort.acquire() — 분산 lease 획득
  ├── ITaskExecutorPort.execute() — 타임아웃 강제
  ├── 성공: 출력 스냅샷 저장 → 하류 ready 태스크 디스패치
  ├── 실패: 재시도 정책 → DLQ 또는 nack
  └── 전체 완료 시: DAG 런 종료화
```

### 하류 태스크 디스패치

- 하류 노드의 모든 upstream 태스크 완료 여부 확인
- 포트 바인딩 해석: upstream 출력에서 outputKey → inputKey 매핑
- TaskRun 생성 + 큐 메시지 발행

## 데이터 흐름

### 포트 페이로드

```typescript
type TPortPayload = Record<string, TPortValue>;

type TPortValue =
  | TPortPrimitive        // string | number | boolean | null
  | IPortBinaryValue      // kind, mimeType, uri, referenceType, assetId, sizeBytes
  | TPortArrayValue       // TPortValue[]
  | TPortObjectValue;     // Record<string, TPortPrimitive>
```

### 엣지 바인딩

```typescript
interface IDagEdgeDefinition {
  from: string;      // 소스 노드 ID
  to: string;        // 타겟 노드 ID
  bindings: IEdgeBinding[];
}

interface IEdgeBinding {
  outputKey: string;  // 소스 노드의 출력 포트 키
  inputKey: string;   // 타겟 노드의 입력 포트 키
}
```

- upstream 태스크의 출력 스냅샷에서 바인딩에 따라 입력 페이로드 조립
- `NodeIoAccessor` 헬퍼로 타입 안전한 I/O 접근

### 바이너리 데이터

```typescript
interface IPortBinaryValue {
  kind: 'image' | 'video' | 'audio' | 'file';
  mimeType: string;
  uri: string;
  referenceType?: 'asset' | 'uri';
  assetId?: string;
  sizeBytes?: number;
}
```

`MediaReference` 값 객체 — 불변, 팩토리 메서드 패턴.
`AssetAwareTaskExecutorPort` — 바이너리 출력을 자산 스토어에 저장하고 참조로 교체 (데코레이터 패턴).

## 상태 관리

### DagRun 상태 머신 (6 상태, 3 터미널)

```
created ──QUEUE──→ queued ──START──→ running ──COMPLETE_SUCCESS──→ success ✓
   │                  │                  │
   └──CANCEL──→       └──CANCEL──→       ├──COMPLETE_FAILURE──→ failed ✓
                                         └──CANCEL──→ cancelled ✓
```

### TaskRun 상태 머신 (8 상태, 5 터미널)

```
created ──QUEUE──→ queued ──START──→ running ──COMPLETE_SUCCESS──→ success ✓
   │                 │                  │
   └──CANCEL──→      ├──SKIP──→ skipped ✓
                     ├──UPSTREAM_FAIL──→ upstream_failed ✓
                     ├──CANCEL──→ cancelled ✓
                     │                  ├──COMPLETE_FAILURE──→ failed ──RETRY──→ queued
                     │                  └──CANCEL──→ cancelled ✓
```

**핵심**: `failed`는 터미널 아님 — `RETRY` 전이로 `queued`로 복귀 가능 (bounded retry).

### 도메인 이벤트

상태 전이 시 도메인 이벤트 발행:
- Run: `run.queued`, `run.running`, `run.success`, `run.failed`, `run.cancelled`
- Task: `task.queued`, `task.running`, `task.success`, `task.failed`, `task.upstream_failed`, `task.skipped`, `task.cancelled`

## 스토리지/영속성

### 포트 추상화

`IStoragePort` 인터페이스 — 구현체 교체 가능:

| 메서드 그룹 | 주요 메서드 |
|------------|------------|
| Definition | `saveDefinition`, `getDefinition`, `listDefinitions` |
| DagRun | `createDagRun`, `getDagRun`, `updateDagRunStatus` |
| TaskRun | `createTaskRun`, `getTaskRun`, `updateTaskRunStatus`, `saveTaskRunSnapshots`, `incrementTaskAttempt` |

### 구현체

- `InMemoryStoragePort` — 테스트용, dag-core에서 제공
- `FileStoragePort` — 파일시스템 기반, dag-server-core에서 제공 (정의만 파일, 런/태스크는 인메모리)

## 서버 API

Express REST API (dag-server-core):

| 엔드포인트 그룹 | 경로 | 기능 |
|----------------|------|------|
| Definition CRUD | `/v1/dag/definitions/*` | 생성, 수정, 검증, 발행, 조회, 목록 |
| Run Lifecycle | `/v1/dag/runs/*` | 트리거, 조회, 취소, 결과 |
| Asset Management | `/v1/dag/assets/*` | 업로드, 참조, 메타데이터, 콘텐츠 |
| Node Catalog | `/v1/dag/nodes` | 노드 매니페스트 목록 |
| SSE Progress | `/v1/dag/runs/{dagRunId}/progress` | 실시간 진행 스트리밍 |
| Documentation | `/api-docs` | Swagger UI (OpenAPI 3.0.3) |

### 에러 응답

RFC 7807 Problem Details 형식:

```typescript
interface IProblemDetails {
  type: string;       // urn:robota:problems:dag:{category}
  title: string;
  status: number;
  detail: string;
  instance?: string;
  correlationId?: string;
}
```

## 이벤트/진행 보고

### 진행 이벤트 타입

```typescript
type TRunProgressEvent =
  | IExecutionStartedProgressEvent     // execution.started
  | IExecutionCompletedProgressEvent   // execution.completed
  | IExecutionFailedProgressEvent      // execution.failed
  | ITaskStartedProgressEvent          // task.started
  | ITaskCompletedProgressEvent        // task.completed
  | ITaskFailedProgressEvent;          // task.failed
```

### 이벤트 버스

`RunProgressEventBus` (dag-api):
- 인메모리 pub/sub
- `publish(event)` / `subscribe(listener) => unsubscribe`
- SSE 엔드포인트를 통해 클라이언트에 스트리밍

### 클라이언트 수신

`DesignerApiClient.subscribeToRunProgress()`:
- SSE 클라이언트
- 지수 백오프 재연결 지원

## 에러 처리 & 재시도

### Result 패턴

```typescript
type TResult<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

- 모든 도메인 함수가 `TResult` 반환
- throw는 프로그래머 에러에만 사용
- No Fallback Policy: 대체 경로 없음, 실패는 명시적

### 에러 분류

```typescript
interface IDagError {
  code: string;
  category: TErrorCategory;
  message: string;
  retryable: boolean;
  context?: Record<string, unknown>;
}

type TErrorCategory =
  | 'validation'         // retryable: false
  | 'state_transition'   // retryable: false
  | 'lease'              // retryable: false
  | 'dispatch'           // retryable: true
  | 'task_execution';    // varies
```

### 재시도 메커니즘

- `WorkerLoopService`에서 실패 시 attempt 증가 → 재큐잉
- `maxAttempts` 초과 시 DLQ로 이동
- `DlqReinjectService`로 DLQ에서 메인 큐로 재투입

### Dead Letter Queue

- `deadLetterEnabled` / `deadLetterQueue` 설정
- 최대 재시도 초과 메시지를 DLQ에 보관
- 수동 재투입 지원

## 캐싱

**현재 캐싱 전략 없음** — 매 실행마다 전체 수행.

단, 다음의 암묵적 캐싱이 존재:
- Definition snapshot — 런 생성 시 스냅샷 저장, 이후 파싱된 결과 재사용
- Task 출력 스냅샷 — 하류 태스크 입력 조립 시 재사용

## 특이점 및 차별화 요소

### 강점

1. **9개 패키지 세분화**: 각 관심사가 독립 패키지로 명확히 분리
2. **포트/어댑터 패턴**: 인프라 교체 가능 (스토리지, 큐, lease, 시계, 실행기)
3. **Result<T,E> 기반 에러 모델링**: No Fallback Policy 준수
4. **비용 추정**: `estimateCost` + `RunCostPolicyEvaluator`로 사전 비용 관리
5. **자산 관리**: `IAssetStore` + `AssetAwareTaskExecutorPort`로 바이너리 데이터 일급 지원
6. **서버 권위적 실행**: dag-designer는 API 호출만 수행, 실행 로직 없음
7. **멱등성 보장**: 런 키 기반 중복 실행 방지
8. **분산 Lease**: `ILeasePort`로 워커 간 태스크 독점 실행

### 현재 제한

1. 캐싱 전략 부재 (실행 결과 재사용 불가)
2. FileStoragePort가 런/태스크를 인메모리로 관리 (프로덕션 영속성 미비)
3. 워커가 단일 프로세스 내 동작 (분산 워커 구조 미구현)
4. 스케줄러가 외부 트리거 방식 (자체 폴링 루프 없음)
