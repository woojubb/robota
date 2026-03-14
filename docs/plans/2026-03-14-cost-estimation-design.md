# DAG 비용 추정 시스템 설계

## 개요

DAG 실행 전 비용(크레딧)을 예측하여 실행 여부를 결정/제안하는 기능. Orchestrator 레벨에서 처리하며, ComfyUI(runtime) 레이어는 수정하지 않는다.

**비용 단위: 크레딧 (화폐 무관 추상 단위).** 크레딧 → 실제 화폐(KRW, USD 등) 환산은 이번 스코프 밖이며, 추후 과금/결제 시스템이 담당한다.

---

## 아키텍처

### 책임 분리

```
┌─ ComfyUI (Runtime) ────────────┐
│  노드 실행만 담당               │
│  비용에 대해 아무것도 모름       │
│  수정 불가 (immutable)          │
└────────────────────────────────┘

┌─ Orchestrator ─────────────────┐
│  모든 노드에 대해 동일하게:     │
│  1. 노드의 config, input 수집   │
│  2. 스토리지에서 해당 nodeType의 │
│     CEL 수식 + 변수 로드        │
│  3. evaluate(수식, context)     │
│                                │
│  노드 타입별 의미를 모름.       │
│  제네릭하게 수식만 평가.        │
│                                │
│  비용 메타 CRUD API 제공        │
│  (dag-designer에서 호출)        │
└────────────────────────────────┘

┌─ Storage (포트 패턴) ──────────┐
│  ICostMetaStoragePort          │
│  ├── 현재: 파일 어댑터 (JSON)  │
│  └── 추후: MongoDB 어댑터      │
│                                │
│  nodeType별 CEL 수식 + 변수     │
│  모든 비용 지식이 여기에 있음    │
│  재배포 없이 변경 가능           │
└────────────────────────────────┘
```

### 핵심 원칙

1. **Orchestrator는 노드 타입에 무관한 제네릭 로직만 보유** — 새 ComfyUI 노드 추가 시 코드 변경 없음
2. **비용 계산 지식은 스토리지에만 존재** — 수식 + 변수(모델별 크레딧 등)
3. **ComfyUI 레이어 수정 금지** — API boundary 규칙 준수
4. **Orchestrator가 아는 정보**: ComfyUI `/object_info` API 응답 + DAG 정의의 노드 config/input/edge
5. **비용 단위는 크레딧** — 화폐 환산은 별도 과금 시스템 책임

---

## 수식 엔진: CEL (Common Expression Language)

### 선택 근거

- Google이 "DB에 저장된 수식을 런타임에 안전하게 평가"하는 용도로 설계한 표준
- 비튜링완전 — 루프/재귀 불가, 실행 종료 보장, 보안 보장
- Kubernetes, Firebase, Cloud IAM에서 행성 규모 프로덕션 검증
- 타입 안전 — `"5" + 3` 같은 암묵적 변환을 컴파일 시점에 거부
- 저장 시점 검증 — `check()` API로 수식 저장 시 즉시 문법/타입 오류 확인
- 구현체: `@marcbachmann/cel-js` (의존성 0, ESM, TypeScript 내장, 활발한 유지보수)

### 비교 검토 결과

CEL vs JEXL vs JSONata vs JsonLogic vs expr-eval 등 8개 엔진 비교 후 CEL 선택. 상세 비교는 `.design/dag-benchmark/10-expression-engine-research.md`, `.design/dag-benchmark/11-cel-vs-jexl-comparison.md` 참조.

---

## 데이터 모델

### ICostMeta (비용 메타 데이터)

```typescript
interface ICostMeta {
  nodeType: string;              // ComfyUI 노드 타입 (PK)
  displayName: string;           // 관리 UI용 표시명
  category: 'ai-inference' | 'transform' | 'io' | 'custom';
  estimateFormula: string;       // CEL 수식 (사전 추정, 크레딧 반환)
  calculateFormula?: string;     // CEL 수식 (사후 계산, 선택)
  variables: Record<string, unknown>;  // 수식에 주입할 고정값
  enabled: boolean;              // 활성/비활성
  updatedAt: string;             // ISO 8601
}
```

### ICostEstimate (추정 결과)

```typescript
interface ICostEstimate {
  totalEstimatedCredits: number;
  perNode: Record<string, { nodeType: string; estimatedCredits: number }>;
}
```

### ICostPolicy (정책)

```typescript
interface ICostPolicy {
  maxCreditsPerPrompt: number;
}
```

### 스토리지 포트

```typescript
interface ICostMetaStoragePort {
  get(nodeType: string): Promise<ICostMeta | undefined>;
  getAll(): Promise<ICostMeta[]>;
  save(meta: ICostMeta): Promise<void>;
  delete(nodeType: string): Promise<void>;
}
```

**파일 어댑터**: `{dataDir}/cost-meta.json`에 `ICostMeta[]` 저장. 서버 시작 시 로드, 변경 시 파일 쓰기.
**추후**: MongoDB 어댑터로 교체.

---

## 비용 메타 예시

```json
{
  "nodeType": "llm-text-openai",
  "displayName": "LLM Text (OpenAI)",
  "category": "ai-inference",
  "variables": {
    "modelRates": {
      "gpt-4o-mini": { "input": 0.15, "output": 0.6 },
      "gpt-4o": { "input": 2.5, "output": 10.0 }
    }
  },
  "estimateFormula": "len(input.prompt) / 4.0 * modelRates[config.model].input + double(config.maxTokens > 0 ? config.maxTokens : 4096) * modelRates[config.model].output",
  "calculateFormula": "usage.promptTokens * modelRates[config.model].input + usage.completionTokens * modelRates[config.model].output",
  "enabled": true,
  "updatedAt": "2026-03-15T00:00:00Z"
}
```

```json
{
  "nodeType": "seedance-video",
  "displayName": "Seedance Video",
  "category": "ai-inference",
  "variables": {
    "baseCost": 8.0,
    "perSecondRate": 1.0,
    "imageSurcharge": 2.0
  },
  "estimateFormula": "baseCost + double(config.durationSeconds > 0 ? config.durationSeconds : 5) * perSecondRate + (size(input.images) > 0 ? imageSurcharge : 0.0)",
  "enabled": true,
  "updatedAt": "2026-03-15T00:00:00Z"
}
```

```json
{
  "nodeType": "image-loader",
  "displayName": "Image Loader",
  "category": "io",
  "variables": {},
  "estimateFormula": "0",
  "enabled": true,
  "updatedAt": "2026-03-15T00:00:00Z"
}
```

---

## Orchestrator API

### 비용 메타 관리 API

```
GET    /v1/cost-meta              → 전체 목록 조회
GET    /v1/cost-meta/:nodeType    → 단건 조회
POST   /v1/cost-meta              → 생성 (CEL check() 검증 포함)
PUT    /v1/cost-meta/:nodeType    → 수정 (CEL check() 검증 포함)
DELETE /v1/cost-meta/:nodeType    → 삭제
```

### 수식 검증/미리보기 API

```
POST   /v1/cost-meta/validate     → 수식만 검증 (저장 안 함)
POST   /v1/cost-meta/preview      → 테스트 input으로 수식 평가 결과 미리보기
```

**validate 요청/응답:**

```json
// Request
{ "formula": "len(input.prompt) / 4.0 * rate", "variables": { "rate": 0.1 } }
// Response
{ "ok": true }
// 또는
{ "ok": false, "errors": ["unknown identifier: rate2"] }
```

**preview 요청/응답:**

```json
// Request
{
  "formula": "baseCost + double(config.duration) * perSec",
  "variables": { "baseCost": 8.0, "perSec": 1.0 },
  "testContext": { "input": {}, "config": { "duration": 10 } }
}
// Response
{ "ok": true, "result": 18.0 }
```

---

## 비용 추정 통합 — DAG 실행 흐름

### 실행 전 추정 (Pre-Submission Estimation)

```
사용자가 DAG 실행 요청
    ↓
Orchestrator가 prompt의 모든 노드 순회
    ↓
각 노드: ICostMetaStoragePort.get(nodeType)
    ├── 수식 있음 → evaluate(formula, { input, config, ...variables })
    └── 수식 없음 → 0 (무료)
    ↓
전체 크레딧 합산 → ICostEstimate { totalEstimatedCredits, perNode }
    ↓
ICostPolicyEvaluator.evaluate(estimate, policy)
    ├── 통과 → ComfyUI에 prompt 제출
    └── 초과 → 에러 반환 (CREDIT_LIMIT_EXCEEDED)
```

### 기존 포트 변경

```typescript
// 현재 (너무 좁음)
estimateCost(nodeTypes: string[], objectInfo: TObjectInfo)

// 변경: prompt 전체에 접근 (각 노드의 class_type + inputs 포함)
estimateCost(prompt: TPrompt, objectInfo: TObjectInfo)
```

### Orchestrator 코드 (제네릭)

```typescript
function estimateNodeCost(
  nodeType: string,
  input: TPortPayload,
  config: INodeConfigObject
): number {
  const costMeta = storage.getCostMeta(nodeType)
  if (!costMeta) return 0

  const context = {
    input,
    config,
    ...costMeta.variables
  }
  return evaluate(costMeta.estimateFormula, context)
}
```

### 중간 노드 input 문제

- 첫 번째 레벨 노드: input을 정확히 알므로 정확한 추정
- 중간 노드: 이전 노드의 output에 의존하므로 정확한 input을 모름
- 대응: config 기반 추정 (예: `config.maxTokens`으로 worst-case), `estimateFormula`(사전)과 `calculateFormula`(사후) 분리

---

## dag-designer UI — 비용 관리

### 진입점

dag-designer 내에 "비용 관리" 버튼 → 비용 관리 패널 오픈

### 목록 화면

```
┌─ 비용 관리 ──────────────────────────────────┐
│                                              │
│  [+ 새 노드 등록]                             │
│                                              │
│  노드 타입          │ 카테고리    │ 상태      │
│  ─────────────────┼───────────┼──────────  │
│  llm-text-openai   │ ai-inference│ ✓ 활성   │
│  seedance-video    │ ai-inference│ ✓ 활성   │
│  image-loader      │ io         │ ✓ 활성   │
│  gemini-image-edit │ ai-inference│ ○ 미등록  │
│                                              │
└──────────────────────────────────────────────┘
```

`/object_info`에서 가져온 전체 노드 목록 표시. 스토리지에 수식이 등록된 노드는 "활성", 없으면 "미등록".

### 편집 화면

```
┌─ llm-text-openai 비용 설정 ──────────────────┐
│                                              │
│  카테고리: [ai-inference ▼]                   │
│                                              │
│  ── 수식 작성 방법 ──                          │
│  [● 템플릿]  [○ AI 어시스턴트]  [○ 직접 입력] │
│                                              │
│  ── 사전 추정 수식 ──                          │
│  ┌────────────────────────────────────────┐  │
│  │ len(input.prompt) / 4.0 *              │  │
│  │   modelRates[config.model].input +     │  │
│  │   double(config.maxTokens > 0 ?        │  │
│  │     config.maxTokens : 4096) *         │  │
│  │   modelRates[config.model].output      │  │
│  └────────────────────────────────────────┘  │
│  검증: ✓ 유효                                 │
│                                              │
│  ── 변수 (고정값) ──                           │
│  modelRates:                                 │
│    gpt-4o-mini: { input: 0.15,               │
│                   output: 0.6 }              │
│    gpt-4o:      { input: 2.5,                │
│                   output: 10.0 }             │
│                                              │
│  ── 테스트 ──                                 │
│  input.prompt: [Hello world test...]         │
│  config.model: [gpt-4o-mini]                 │
│  config.maxTokens: [4096]                    │
│  → 예상 크레딧: 2.49                          │
│                                              │
│  [취소]  [저장]                                │
└──────────────────────────────────────────────┘
```

### 수식 작성 3가지 모드

1. **템플릿**: "토큰 기반", "매수 기반", "시간 기반", "고정 금액" 선택 → 파라미터 입력 → CEL 자동 생성
2. **AI 어시스턴트**: 자연어로 계산 방식 설명 → AI가 CEL 생성 → 검증
3. **직접 입력**: CEL 수식 직접 작성 (고급 사용자용)

모든 모드에서 `/v1/cost-meta/validate`로 실시간 검증, `/v1/cost-meta/preview`로 테스트.

### DAG 실행 전 비용 표시

```
┌─ DAG 실행 확인 ─────────────────┐
│                                 │
│  예상 크레딧:                    │
│  ├─ input_1 (input)        0.0  │
│  ├─ llm_1 (llm-text)      2.5  │
│  ├─ image_1 (gemini)       1.0  │
│  └─ video_1 (seedance)    18.0  │
│  ──────────────────────────     │
│  합계:                    21.5  │
│                                 │
│  크레딧 한도: 100.0             │
│                                 │
│  [취소]  [실행]                  │
└─────────────────────────────────┘
```

---

## 기존 시스템 마이그레이션

### Usd → Credits 필드명 변경

기존 dag-core에 하드코딩된 `Usd` 접미사 필드를 크레딧으로 변경:

| 기존 | 변경 |
|------|------|
| `estimatedCostUsd` | `estimatedCredits` |
| `totalCostUsd` | `totalCredits` |
| `maxCostPerPromptUsd` | `maxCreditsPerPrompt` |
| `runCostLimitUsd` | `runCreditLimit` |
| `ICostEstimate.estimatedCostUsd` | `ICostEstimate.estimatedCredits` |

### 기존 포트 변경

- `ICostEstimatorPort` 구현체를 CEL 기반 스토리지 레지스트리로 교체
- 포트 시그니처 확장: `nodeTypes[]` → `TPrompt` (config, input 포함) 접근
- `IRunResult`의 비용 필드를 실제 값으로 채움

---

## 비용 원천

| 원천 | 예시 | 수식에서 참조하는 필드 |
|------|------|---------------------|
| AI API 호출 | LLM 토큰, 이미지 생성, 비디오 생성 | `input.prompt`, `config.model`, `config.maxTokens`, `config.durationSeconds` |
| GPU/CPU 컴퓨팅 | 이미지 처리, 변환 | `config.resolution`, 처리 시간 추정 |
| DB/스토리지 | 쿼리, 저장 | `config.queryCount`, 데이터 크기 |
| 외부 서비스 | 제3자 API 호출 | per-call 고정 크레딧 |

---

## 리서치 문서

| 문서 | 내용 |
|------|------|
| `.design/dag-benchmark/09-cost-estimation-research.md` | 업계 비교 + Weavy.ai 분석 |
| `.design/dag-benchmark/10-expression-engine-research.md` | 수식 엔진 비교 (8개) |
| `.design/dag-benchmark/11-cel-vs-jexl-comparison.md` | CEL vs JEXL 직접 비교 |

---

## 미결정 사항

- [ ] 사후 비용 계산 (calculateFormula) 데이터 소스 — ComfyUI /history에서 어디까지 알 수 있는지
- [ ] 중간 노드 input 추정 전략 상세화
- [ ] costPolicy 확장 (노드별 한도, DAG 전체 한도, 사용자별 한도)
- [ ] 비용 리포팅/대시보드 요구사항
- [ ] 크레딧 → 실제 화폐 환산 시스템 (과금/결제 레이어)
