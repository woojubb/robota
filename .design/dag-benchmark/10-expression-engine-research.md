# 비용 계산 수식 엔진 리서치

## 목적

오케스트레이터 레벨에서 노드별 비용 계산 공식을 DB에 저장하고 런타임에 안전하게 평가하기 위한 수식 엔진을 조사한다. "DB에 저장된 수식을 런타임에 JSON 컨텍스트 데이터와 함께 안전하게 평가"하는 패턴에 적합한 표준/라이브러리를 비교 분석한다.

---

## 1. 배경: 왜 수식 엔진이 필요한가

### 문제

- ComfyUI에 새 노드가 추가될 때마다 오케스트레이터를 재배포하지 않고도 비용 계산 규칙을 추가/수정해야 함
- 단순 선언적 JSON 규칙(`{ "type": "fixed", "cost": 0.01 }`)으로는 동적 계산(토큰 수 × 모델별 단가, 해상도별 차등 등)을 표현하기 어려움
- 임의의 JavaScript 실행은 보안 위험(코드 인젝션)이 있음

### 요구사항

1. DB에 문자열로 저장 가능한 수식
2. 런타임에 JSON 컨텍스트(input, config, usage 등)를 주입하여 평가
3. 보안: 시스템 접근, 무한 루프, 사이드이펙트 불가
4. TypeScript/Node.js 환경 지원
5. 사칙연산, 조건문, 필드 접근, lookup 테이블 등 지원

---

## 2. 주요 수식 엔진 비교

| 엔진 | 개발/관리 | npm 주간 다운로드 | 프로덕션 사용처 | 안전성 | TypeScript | 표현력 | 성능 |
|------|----------|-----------------|---------------|--------|------------|--------|------|
| **CEL** | Google | ~21K (`@marcbachmann/cel-js`) | Kubernetes, Firebase, Envoy, Cloud IAM | **비튜링완전 (설계상 안전)** — 루프/재귀 없음, 실행 종료 보장 | 완전 지원 | 높음: 수학, 조건, 문자열, 리스트/맵 연산, 매크로 | **매우 빠름** (대안 대비 3-22x) |
| **JEXL** | Mozilla | ~60K | Mozilla SHIELD/Normandy, Harness, Sentry | 샌드박스 컨텍스트, 시스템 접근 불가, 커스텀 transform | 타입 제공 | 높음: 수학, 조건, transform 파이프, 삼항, 중첩 속성 | 좋음 (컴파일된 표현식 재사용) |
| **JSONata** | IBM/커뮤니티 | ~950K | AWS Step Functions, Node-RED, Zendesk | 샌드박스이나 튜링완전 (람다/재귀 가능) | 타입 포함 | 매우 높음: JSON 탐색, 집계, 수학, 조건, 사용자 정의 함수 | 좋음 (파서가 무거움) |
| **JsonLogic** | 커뮤니티 | ~475K-1M | 다국어 구현 (JS, Python, PHP, Ruby) | **JSON 전용, 인젝션 원천 불가** | @types 제공 | 중간: 조건, 수학, 배열, 그러나 JSON 문법이 장황 | 좋음 (단순 인터프리터) |
| **mathjs** | 커뮤니티 | ~2.5M | 데이터 과학, 엔지니어링 도구 | 샌드박스 파서 (eval/Function 차단), 스코프 설정 가능 | 지원 | 매우 높음: 전체 수학 라이브러리, 단위, 행렬, 커스텀 함수 | 좋음 (번들 ~175KB로 큼) |
| **expr-eval** | 커뮤니티 | ~800K | — | **CVE-2025-12735 (RCE, CVSS 9.8)** — 프로토타입 오염 취약점, 미패치 | 네이티브 TS 없음 | 중간: 수학, 조건, 커스텀 함수 | 빠름 (단순 파서) |
| **Filtrex** | 커뮤니티 | 소규모 | 니치 | **우수**: JS 함수로 컴파일, 루프/재귀 없음, 예외 안 던짐 | 지원 | 중간: 스프레드시트형 수식, 커스텀 함수 | **매우 빠름** (네이티브 JS 컴파일) |
| **json-rules-engine** | 커뮤니티 | ~248K | Node.js 프로젝트 | 안전 (JSON 규칙, 코드 실행 없음) | 지원 | 중간: 조건+액션 패턴, 수식 계산 지향이 아님 | 좋음 |
| **OPA/Rego** | CNCF | 소규모 (Wasm SDK) | Netflix, Goldman Sachs, Kubernetes admission | 완전 샌드박스 (Wasm 경계) | Wasm SDK | 정책에 높음, 수학 수식에는 어색 | Wasm 오버헤드 |

---

## 3. 상세 분석: 상위 3개 후보

### 3.1 CEL (Common Expression Language) — 최우선 추천

**개요:** Google이 "런타임에 안전한 수식 평가"를 위해 설계한 표준 언어. Kubernetes, Firebase, Envoy, Google Cloud IAM에서 행성 규모로 사용 중.

**핵심 특징:**
- **비튜링완전(Non-Turing-complete)**: 루프, 재귀 불가능 → 무한 실행 원천 차단
- 구조적 제한 설정 가능: `maxAstNodes`, `maxDepth`, `maxListElements`
- 다국어 사양 (Go, Java, C++, JS) — 수식의 언어 간 이식성
- JS 구현체 (`@marcbachmann/cel-js`): 의존성 0, ESM, TypeScript 완전 지원

**비용 계산 수식 예시:**

```cel
// LLM 토큰 기반 비용
len(input.prompt) / 4 * modelRates[config.model].input
  + (config.maxTokens > 0 ? config.maxTokens : 4096) * modelRates[config.model].output

// 구간별 차등 단가
quantity <= 100 ? quantity * 10.0
  : 100 * 10.0 + (quantity - 100) * 8.0

// 비디오 생성 비용
baseCost + (config.durationSeconds > 0 ? config.durationSeconds : 5) * perSecondRate
  + (size(input.images) > 0 ? 0.02 : 0)
```

**평가 코드:**

```typescript
import { evaluate } from '@marcbachmann/cel-js'

const formula = 'len(input.prompt) / 4 * modelRates[config.model].input'
const context = {
  input: { prompt: "Hello world..." },
  config: { model: "gpt-4o-mini" },
  modelRates: { "gpt-4o-mini": { input: 0.00000015, output: 0.0000006 } }
}
const costUsd = evaluate(formula, context)
```

**장점:**
- 이 용도를 위해 설계된 표준
- 보안이 언어 수준에서 보장됨
- 성능 최고 (대안 대비 3-22x)
- Google 생태계에서 검증됨

**단점:**
- JS 구현체의 npm 다운로드가 상대적으로 적음 (~21K)
- CEL 사양의 모든 기능이 JS 구현에 포함되지 않을 수 있음

### 3.2 JEXL (JavaScript Expression Language)

**개요:** Mozilla가 SHIELD/Normandy 시스템(Firefox 원격 설정)을 위해 개발. Harness, Sentry에서 프로덕션 사용.

**핵심 특징:**
- Transform 파이프 문법: `price|discount(0.1)|round`
- 비동기 평가 지원 (lookup 데이터 fetch 필요 시)
- CEL보다 단순한 API, 익숙한 문법

**비용 계산 수식 예시:**

```jexl
// LLM 비용
input.prompt.length / 4 * modelRates[config.model].input

// Transform 파이프 활용
baseCost|addSurcharge(config.durationSeconds, perSecondRate)
```

**장점:**
- 7년 이상 성숙한 JS 생태계
- Transform 파이프 문법으로 가독성 높음
- 비동기 평가 가능

**단점:**
- 튜링완전성이 공식적으로 제한되지 않음 (CEL보다 약한 안전 보장)
- Google 같은 대규모 사용 사례 부족

### 3.3 JSONata

**개요:** IBM이 시작하고 커뮤니티가 발전시킨 JSON 쿼리/변환 언어. AWS Step Functions의 공식 표현식 언어로 채택됨.

**핵심 특징:**
- 복잡한 JSON 구조 탐색/변환에 최적화
- 집계 함수 ($sum, $avg, $max 등) 내장
- 사용자 정의 함수 등록 가능

**비용 계산 수식 예시:**

```jsonata
// LLM 비용
$length(input.prompt) / 4 * $lookup(modelRates, config.model).input

// 배열 노드 비용 합산
$sum(nodes.(baseCost + dynamicCost))
```

**장점:**
- AWS Step Functions 채택으로 검증됨
- JSON 데이터 처리에 가장 강력
- npm 다운로드 최다 (~950K)

**단점:**
- 튜링완전 (람다/재귀 지원) → CEL보다 약한 안전 보장
- 단순 수식 계산에는 과도한 기능
- 파서가 무거움

---

## 4. 업계 과금 시스템의 접근 방식

| 시스템 | 접근 방식 |
|--------|----------|
| **Stripe** | 선언적 규칙 (scheme당 최대 125개). 조건/연산자/값 + 수수료 유형(고정/비율/혼합). 범용 수식 엔진 아님 — 하드코딩된 규칙 구조 |
| **Lago** (OSS) | 미리 정의된 과금 모델 (graduated, package, percentage, volume). Ruby BigDecimal. 사용자 정의 수식 없음 |
| **Kill Bill** (OSS) | 플러그인 아키텍처 (Java). 카탈로그 규칙 + 플러그인. 수식 DSL 없음 |
| **OpenMeter** | 사용량 미터링 + Stripe 연동. API 설정 기반 과금 모델 |

**시사점:** 대부분의 프로덕션 과금 시스템은 범용 수식 엔진을 쓰지 않고 미리 정의된 과금 모델 유형을 사용한다. 그러나 Robota처럼 **노드 타입마다 계산 방식이 다른** 경우에는 범용 수식 엔진이 더 적합하다.

---

## 5. 최종 추천

### 1순위: CEL (`@marcbachmann/cel-js`)

- 이 용도를 위해 설계된 Google 표준
- 비튜링완전 = 언어 수준 보안 보장
- 행성 규모 프로덕션 검증 (Kubernetes, Firebase)
- 최고 성능, 의존성 0, TypeScript 완전 지원
- 다국어 이식성 (Go, Java, C++ 구현 존재)

### 2순위: JEXL

- Transform 파이프 문법이 필요한 경우
- 비동기 평가가 필요한 경우
- 더 성숙한 JS 생태계 (7년+, 60K 주간 다운로드)

### 사용 금지

- **expr-eval** — CVE-2025-12735 RCE 취약점 (CVSS 9.8), 미패치, 유지보수 중단
- **mathjs** — 번들 크기 과대 (~175KB), 이 용도에 과도한 기능
- **OPA/Rego** — 인가 정책용, 수식 계산에 부적합

---

## 6. CEL 기반 비용 계산 적용 예시

### DB 저장 구조

```json
{
  "nodeType": "llm-text-openai",
  "variables": {
    "modelRates": {
      "gpt-4o-mini": { "input": 0.00000015, "output": 0.0000006 },
      "gpt-4o": { "input": 0.0000025, "output": 0.00001 }
    }
  },
  "estimateFormula": "len(input.prompt) / 4 * modelRates[config.model].input + (config.maxTokens > 0 ? config.maxTokens : 4096) * modelRates[config.model].output",
  "calculateFormula": "usage.promptTokens * modelRates[config.model].input + usage.completionTokens * modelRates[config.model].output"
}
```

```json
{
  "nodeType": "seedance-video",
  "variables": {
    "baseCost": 0.08,
    "perSecondRate": 0.01,
    "imageSurcharge": 0.02
  },
  "estimateFormula": "baseCost + (config.durationSeconds > 0 ? config.durationSeconds : 5) * perSecondRate + (size(input.images) > 0 ? imageSurcharge : 0)",
  "calculateFormula": "baseCost + output.durationSeconds * perSecondRate + (size(input.images) > 0 ? imageSurcharge : 0)"
}
```

```json
{
  "nodeType": "image-loader",
  "variables": {},
  "estimateFormula": "0",
  "calculateFormula": "0"
}
```

### 평가 코드

```typescript
import { evaluate } from '@marcbachmann/cel-js'

function estimateNodeCost(
  nodeType: string,
  input: TPortPayload,
  config: INodeConfigObject,
  costMeta: INodeCostMeta  // DB에서 로드
): number {
  const context = {
    input,
    config,
    ...costMeta.variables
  }
  return evaluate(costMeta.estimateFormula, context) as number
}
```

---

## 참고 자료

- [CEL 사양 (Google)](https://github.com/google/cel-spec)
- [CEL in Kubernetes](https://kubernetes.io/docs/reference/using-api/cel/)
- [CEL in Firebase](https://firebase.google.com/docs/data-connect/cel-reference)
- [@marcbachmann/cel-js](https://github.com/marcbachmann/cel-js)
- [JEXL npm](https://www.npmjs.com/package/jexl)
- [Mozilla mozjexl](https://github.com/mozilla/mozjexl)
- [JSONata 공식](https://jsonata.org/)
- [JSONata in AWS Step Functions](https://medium.com/ssense-tech/step-functions-in-2025-simplify-your-development-with-jsonata-1590b6c439d3)
- [mathjs 보안](https://mathjs.org/docs/expressions/security.html)
- [expr-eval RCE 취약점 (CVE-2025-12735)](https://www.bleepingcomputer.com/news/security/popular-javascript-library-expr-eval-vulnerable-to-rce-flaw/)
- [JsonLogic](https://jsonlogic.com/)
- [Filtrex](https://github.com/joewalnes/filtrex)
- [Stripe Pricing Schemes](https://docs.stripe.com/connect/platform-pricing-tools/pricing-schemes)
- [Lago OSS Billing](https://github.com/getlago/lago)
- [Google CEL 블로그](https://opensource.googleblog.com/2024/06/common-expressions-for-portable-policy.html)
