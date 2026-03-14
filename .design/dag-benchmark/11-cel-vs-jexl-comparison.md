# CEL vs JEXL 직접 비교

## 목적

오케스트레이터 레벨 비용 계산 수식 엔진으로 CEL과 JEXL을 직접 비교하여 최종 선택을 결정한다.

---

## 1. 기본 정보

| | JEXL | CEL (`@marcbachmann/cel-js`) |
|---|------|-----|
| **만든 곳** | TomFrost (개인) | Google (공식 사양) |
| **주간 다운로드** | 82K | 78K (CEL 전체 구현 합산 262K) |
| **마지막 업데이트** | 2022년 6월 (4년 전) | 2026년 3월 10일 |
| **미해결 이슈** | 26개 | 1개 |
| **의존성** | 1개 (@babel/runtime) | 0개 |
| **TypeScript** | 커뮤니티 @types | 내장 |
| **라이선스** | MIT | MIT |
| **GitHub Stars** | 644 | 127 |
| **사양 표준** | 없음 (개인 설계) | Google CEL 공식 사양 |

---

## 2. Harness의 JEXL 사용에 대한 중요 사실

Harness는 **Java JEXL3**를 사용한다 (npm `jexl`이 아님). Java 버전은 함수 정의, for 루프, 변수 할당을 지원하지만, JS `jexl` npm 패키지에는 이 기능이 없다. 같은 이름이지만 완전히 다른 라이브러리다.

- **Harness (Java JEXL3)**: 파이프라인 변수 참조, 스테이지 간 조건 로직, 문자열 처리, 함수 정의/루프/if-else
- **Sentry (JS JEXL)**: 통합 플랫폼 UI 필드의 조건부 표시/숨김 (경량 사용)
- **Mozilla (mozjexl fork)**: SHIELD/Normandy 실험 전달 시스템 (fork가 필요할 정도로 upstream이 불충분)

---

## 3. 동일 수식 비교

### a) LLM 토큰 비용

```
JEXL:  prompt_length / 4 * rates[model].input + max_tokens * rates[model].output
CEL:   double(prompt_length) / 4.0 * rates[model].input + double(max_tokens) * rates[model].output
```

### b) 비디오 생성 비용

```
JEXL:  base_cost + duration * per_sec + (image_count > 0 ? surcharge : 0)
CEL:   base_cost + duration * per_sec + (image_count > 0 ? surcharge : 0.0)
```

### c) 구간 차등 단가 (100개까지 $10, 400개까지 $8, 이후 $5)

```
둘 다 동일: min(units, 100) * 10 + min(max(units - 100, 0), 400) * 8 + max(units - 500, 0) * 5
(양쪽 모두 min/max를 커스텀 함수로 등록 필요)
```

### d) 조건부 모델 가격

```
JEXL:  model == "gpt-4" ? tokens * 0.03 : (model == "gpt-3.5" ? tokens * 0.002 : tokens * 0.01)
CEL:   model == "gpt-4" ? tokens * 0.03 : model == "gpt-3.5" ? tokens * 0.002 : tokens * 0.01
```

### e) Lookup 테이블 방식 (양쪽 동일)

```
tokens * rates[model]
```

문법은 거의 동일하다. CEL이 `double()` 명시적 캐스팅을 요구하는 정도의 차이.

---

## 4. 비용 계산에 치명적인 차이

| 상황 | JEXL | CEL |
|------|------|-----|
| `"5" + 3` | `"53"` (JS 암묵적 변환) | **타입 에러** (컴파일 시점 거부) |
| `0 / 0` | `NaN` (무음 실패) | **런타임 에러** (잡을 수 있음) |
| 없는 필드 접근 | `undefined` → 계산에 `NaN` 전파 | **no_such_field 에러** |
| `null.field` | 예외 던짐 | `has(obj.field)` 로 안전 검사 |
| 정수 나눗셈 `7 / 2` | `3.5` (JS float) | `3` (정수), `7.0 / 2.0` → `3.5` |

비용 계산에서 암묵적 타입 변환은 위험하다. `"5" + 3 = "53"`이 DB에 저장된 수식에서 발생하면 찾기 매우 어렵다.

---

## 5. CEL만의 장점: 저장 시점 검증

```typescript
const env = new Environment({
  limits: { maxAstNodes: 500, maxDepth: 20 }
})

// DB에 수식 저장할 때 — 문법/타입 검증
const errors = env.check(formulaFromAdmin)
if (errors) throw new Error('잘못된 수식')

// 런타임 평가 — 이미 검증된 수식
const cost = env.evaluate(formula, context)
```

JEXL에는 사전 검증(compile-time check) API가 없다.

---

## 6. 확장성 비교

### JEXL 커스텀 함수/Transform

```javascript
jexl.addTransform('upper', (val) => val.toUpperCase())
// 사용: name|upper

jexl.addFunction('min', (...args) => Math.min(...args))
// 사용: min(a, b, c)

jexl.addBinaryOp('**', 100, (left, right) => Math.pow(left, right))
// 사용: 2 ** 3
```

### CEL 커스텀 함수

```typescript
const env = new Environment()
env.registerFunction('max(double, double) -> double', Math.max)
env.registerFunction('min(double, double) -> double', Math.min)
env.registerFunction('ceil(double) -> double', Math.ceil)
env.registerFunction('floor(double) -> double', Math.floor)
env.registerFunction('round(double) -> double', Math.round)
env.registerConstant('PI', 'double', 3.14159)
```

CEL은 함수 시그니처(타입 포함)를 명시해야 하므로 약간 더 장황하지만, 타입 안전이 보장된다.

---

## 7. 종합 점수

| 항목 | JEXL | CEL | 승자 |
|------|------|-----|------|
| 수식 가독성 | JS와 유사 | 약간 명시적 | 동점 |
| 수학 연산 | 커스텀 추가 필요 | 커스텀 추가 필요 | 동점 |
| 커스텀 함수 | 쉬움 (addFunction) | 쉬움 (registerFunction + 타입) | 동점 |
| 비동기 지원 | 네이티브 | 지원 | 동점 |
| 배열 필터 | `arr[.age > 30]` | `arr.filter(x, x.age > 30)` | 동점 |
| **타입 안전** | 없음 | 컴파일 타임 검사 | **CEL** |
| **보안/샌드박스** | 좋음 (글로벌 접근 차단) | 비튜링완전 + 구조 제한 | **CEL** |
| **null 안전** | 취약 (JS 변환) | 명시적, has() | **CEL** |
| **에러 품질** | 기본적 | 컴파일+런타임 타입 에러 | **CEL** |
| **성능** | 좋음 | 10x 빠름 (벤치마크) | **CEL** |
| **유지보수** | 4년째 방치 | 활발 (2026년 3월) | **CEL** |
| **의존성** | 1개 | 0개 | **CEL** |
| **사양 표준** | 없음 (개인) | Google 공식 사양 | **CEL** |
| 파이프 문법 | `value\|transform` | 없음 | JEXL |
| 학습 곡선 | 낮음 | 약간 높음 | JEXL |

**CEL 11승, JEXL 2승, 동점 5**

---

## 8. 결론: CEL 선택

### 선택 근거

1. **타입 안전**: 비용 계산에서 암묵적 변환은 치명적. CEL의 엄격한 타입이 이를 원천 차단
2. **저장 시점 검증**: DB에 수식 저장 시 `check()` API로 즉시 문법/타입 오류 확인 가능
3. **유지보수**: JEXL은 사실상 방치. CEL은 활발히 관리 중
4. **보안**: 비튜링완전 + 구조 제한 (maxAstNodes, maxDepth) 으로 수식 폭발 방지
5. **의존성 0**: 공급망 위험 없음
6. **Google 사양**: Kubernetes, Firebase, Cloud IAM에서 행성 규모 검증. 지식 이전 가능

### 트레이드오프 수용

- `double()` 명시적 캐스팅 → 비용 계산의 정확성을 위해 수용
- 파이프 문법 없음 → 함수 호출 문법으로 충분히 대체 가능
- 약간 높은 학습 곡선 → 수식 작성 도구/가이드로 보완

### 사용할 구현체

`@marcbachmann/cel-js` (v7.5.3+)
- 의존성 0, ESM, TypeScript 내장
- 가장 활발한 유지보수
- 가장 빠른 성능

---

## 참고 자료

- [CEL 사양 (Google)](https://github.com/google/cel-spec)
- [@marcbachmann/cel-js](https://github.com/marcbachmann/cel-js)
- [JEXL npm](https://www.npmjs.com/package/jexl)
- [Harness JEXL Expressions](https://developer.harness.io/docs/platform/variables-and-expressions/harness-variables/)
- [Mozilla mozjexl](https://github.com/mozilla/mozjexl)
- [CEL in Kubernetes](https://kubernetes.io/docs/reference/using-api/cel/)
- [CEL in Firebase](https://firebase.google.com/docs/data-connect/cel-reference)
