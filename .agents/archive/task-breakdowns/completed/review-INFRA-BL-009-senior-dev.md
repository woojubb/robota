# INFRA-BL-009 시니어 개발자 리뷰: 빌드 도구 마이그레이션

**리뷰어**: 시니어 개발자 관점  
**리뷰 대상**: `.agents/tasks/INFRA-BL-009-build-tool-migration.md`  
**리뷰 일자**: 2026-05-15

---

## 1. 백로그 설계 품질 평가

### 1.1 Recommendation Gate — 미비

`backlog-execution.md` §Recommendation Gate 기준:

| 필수 항목                                   | 현재 상태                       | 평가                                   |
| ------------------------------------------- | ------------------------------- | -------------------------------------- |
| 구현/문서 접근법                            | 부분 존재 (4단계 순서)          | 부족: tsdown vs unbuild 선택 기준 없음 |
| 백로그 의도와의 일치 근거                   | 없음                            | 누락                                   |
| 규칙·레이어링·소유권·아키텍처 경계 부합     | 없음                            | 누락                                   |
| 영향 패키지 목록                            | "all 48 packages" (실제는 57개) | 부족: 유형별 분류 없음                 |
| 테스트 및 검증 계획                         | 최하단 3줄 generic              | 매우 부족                              |
| User Execution Test Scenarios 또는 N/A 사유 | **없음**                        | **누락**                               |
| 사용자 결정이 필요한 항목                   | 없음                            | 누락                                   |

### 1.2 User Execution Test Scenarios — 전면 누락 (규칙 위반)

현재 `## 검증` 섹션(라인 80–84):

```
- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
```

이는 `backlog-execution.md` Done Gate 규칙 직접 위반이다:

> Build, typecheck, lint, and unit tests are completely unrelated to User Execution Test Scenarios. They belong in `## Test Plan`.

빌드 도구 마이그레이션은 runnable user-facing behavior를 변경한다:

- `pnpm build` 명령 동작 변경
- `pnpm --filter <pkg> build` 동작 변경
- `pnpm harness:scan` (check-build-output-contracts) 동작 변경

따라서 **User Execution Test Scenarios 섹션 필수**이며, 현재 검증 섹션은 Test Plan으로 이동되어야 한다.

### 1.3 Test Plan — 미비

현재 검증 섹션은 Test Plan으로 보아도 불충분하다:

- 어떤 패키지를 빌드 검증하는지 구체성 없음
- harness 검증 커맨드 명시 없음
- DTS 출력 계약 검증 방법 없음
- browser 빌드 파일 존재 확인 방법 없음
- publish 후 npm 소비 테스트 계획 없음

### 1.4 Done Gate 충족 조건 — 정의 불가 상태

User Execution Test Scenarios가 없으므로 Done Gate Stage 1, 2 모두 정의되지 않은 상태다. 이 태스크는 현재 규칙상 `done`으로 설정될 수 없는 구조이다.

---

## 2. 기술 구현 리스크 평가

### 2.1 tsdown 출력 확장자 불일치 — 해결책 미명시

**문제**: tsdown 기본 동작

```bash
tsdown src/index.ts --format esm,cjs --dts
# → dist/index.mjs (ESM)
# → dist/index.cjs (CJS)
# → dist/index.d.mts (DTS)
```

**현재 계약**:

```
dist/node/index.js   (ESM)
dist/node/index.cjs  (CJS)
dist/node/index.d.ts (DTS)
```

**해결책** (태스크 파일에 없음):

```ts
// tsdown.config.ts
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist/node',
  format: ['esm', 'cjs'],
  dts: true,
  outExtensions: ({ format }) => ({
    js: format === 'cjs' ? '.cjs' : '.js',
    dts: '.d.ts', // .d.mts 대신 .d.ts 강제
  }),
});
```

단 `outExtensions`의 `dts` 키가 tsdown 공식 API에 실제로 존재하는지 추가 검증 필요.

### 2.2 unbuild dual ESM/CJS + DTS 지원 가능성

unbuild 3.6.1은 안정 릴리즈이며 Rollup 기반이다. dual 빌드 지원 예시:

```ts
// build.config.ts
import { defineBuildConfig } from 'unbuild';
export default defineBuildConfig({
  entries: ['src/index'],
  outDir: 'dist/node',
  declaration: true,
  rollup: {
    emitCJS: true,
    output: {
      exports: 'named',
    },
  },
});
```

**미확인 항목**:

- unbuild에서 `dist/node/` 하위 경로 구조 유지 가능한지
- DTS 확장자 `.d.ts` 출력 기본값인지 (`.d.mts`가 기본인지)
- browser 빌드 분리 지원 여부

### 2.3 browser/node 분리 빌드 — 고위험

현재 agent-core 등은 browser + node 두 빌드를 가진다:

```
dist/
  node/index.js, index.cjs, index.d.ts
  browser/index.js
```

package.json exports:

```json
{
  "node": { "import": "./dist/node/index.js" },
  "browser": { "import": "./dist/browser/index.js" }
}
```

**tsdown**: multi-target 빌드 config 지원 여부 미확인.  
**unbuild**: entries 배열로 별도 구성 가능하나 outDir 분리 방법 검증 필요.

이 유형의 패키지는 PoC에서 반드시 포함해야 한다.

### 2.4 DTS Race Condition 우회 전략 — 미설계

현재 2-pass 전략:

1. `pnpm --filter './packages/**' build:js` — 모든 패키지 JS 병렬 빌드
2. `node scripts/build-types-ordered.mjs` — DTS만 토폴로지 순서로 빌드

이 전략은 tsup에 종속되지 않는다. 신규 도구로 교체해도 이 스크립트는 유지된다. 단, `build:types` 스크립트 커맨드가 신규 도구의 DTS-only 모드를 지원하는지 확인 필요:

```json
// 현재 (tsup)
"build:types": "tsup --dts-only"

// tsdown 대응 예시
"build:types": "tsdown --dts-only"  ← 이 플래그가 tsdown에 있는지 확인 필요

// unbuild 대응
"build:types": "unbuild --stub"  ← 다른 개념이므로 접근법 재설계 필요
```

### 2.5 bin entry 보존 — 검증 미포함

agent-cli는 `bin` 필드를 가진다. 빌드 도구 교체 시 bin entry 파일의 shebang(`#!/usr/bin/env node`)과 실행 권한이 올바르게 생성되는지 확인이 필요하다. 현재 PoC 계획에 bin 패키지 검증이 없다.

---

## 3. PoC 설계 평가

### 3.1 구체성 — 매우 부족

현재 PoC 계획: "1-2개 leaf 패키지에서 PoC를 실행한다"

미비 사항:

- **어떤 패키지?** 선정 기준 없음
- **어떤 도구로?** tsdown인지 unbuild인지 미결정
- **성공 기준?** 빌드 통과만? npm pack 후 소비 테스트까지?
- **측정 항목?** 빌드 시간, 출력 파일 크기 비교 없음

### 3.2 leaf 패키지 선정 기준 제안

PoC는 다음 순서로 복잡도 단계별 패키지를 선정해야 한다:

| 단계 | 패키지                | 이유                              |
| ---- | --------------------- | --------------------------------- |
| 1    | `packages/auth`       | 최소 의존성, node-only, 단순 구조 |
| 2    | `packages/agent-core` | browser dual 빌드, 핵심 계약      |
| 3    | `packages/agent-cli`  | bin entry 포함                    |

### 3.3 PoC 성공 기준 제안

```
[ ] pnpm --filter <pkg> build 성공
[ ] dist/node/index.js 존재
[ ] dist/node/index.cjs 존재
[ ] dist/node/index.d.ts 존재 (.d.mts 아님)
[ ] dist/browser/index.js 존재 (browser dual 패키지만)
[ ] pnpm harness:scan:build-contracts 통과
[ ] npm pack → 다른 패키지에서 import → TypeScript resolution 성공
[ ] 빌드 시간 tsup 대비 측정 (성능 회귀 없음)
```

---

## 4. 구현 개선안

### 4.1 백로그 파일에 추가해야 할 섹션

```markdown
## Prior Art Research

<!-- 외부 레퍼런스, 동일 규모 모노레포 빌드 도구 선택 사례 -->

## Decision Matrix

<!-- tsdown vs unbuild vs tsup 유지 비교 표 -->

## Package Type Classification

<!-- node-only / browser-dual / bin / react 분류 -->

## Test Plan

<!-- 현재 ## 검증 섹션 이동 + 구체화 -->

## User Execution Test Scenarios

<!-- 필수 섹션 -->
```

### 4.2 User Execution Test Scenarios 초안

````markdown
## User Execution Test Scenarios

### 시나리오 1: 단일 패키지 빌드 검증

- agent-executability: agent-executable
- 전제조건: PoC 패키지(auth)의 tsup → 신규 도구 전환 완료
- 명령:
  ```bash
  cd /Users/jungyoun/Documents/dev/robota
  pnpm --filter @robota-sdk/auth build
  ls packages/auth/dist/node/
  # 예상: index.js, index.cjs, index.d.ts
  node -e "const m = require('./packages/auth/dist/node/index.cjs'); console.log(typeof m)"
  ```
````

- 예상 결과: dist/node/index.js, index.cjs, index.d.ts 모두 존재. require() 성공
- 증거: [실행 후 기록]

### 시나리오 2: 전체 빌드 통과

- agent-executability: agent-executable
- 전제조건: 전체 패키지 마이그레이션 완료
- 명령:
  ```bash
  pnpm build
  pnpm harness:scan
  ```
- 예상 결과: build 성공, harness scan 통과 (build-output-contracts 포함)
- 증거: [실행 후 기록]

### 시나리오 3: publish 계약 보존

- agent-executability: agent-executable
- 명령:
  ```bash
  cd packages/auth && npm pack --dry-run
  # package.json main, types, exports 필드 출력 확인
  ```
- 예상 결과: main=dist/node/index.js, types=dist/node/index.d.ts 확인
- 증거: [실행 후 기록]

````

### 4.3 마이그레이션 스크립트 전략 (57개 패키지)

일괄 변환보다 단계별 패치 스크립트 권장:

```js
// scripts/migrate-build-tool.mjs
// 패키지 유형별로 tsup.config.ts → 신규 config 파일 생성
// package.json scripts 업데이트
// 기존 tsup.config.ts 보존(suffix .tsup.bak)하여 롤백 지원
````

롤백: `.tsup.bak` 파일 복원 스크립트 준비.

---

## 5. 종합 평가

| 항목                          | 등급 | 설명                              |
| ----------------------------- | ---- | --------------------------------- |
| Recommendation Gate           | D    | 핵심 항목 다수 누락               |
| User Execution Test Scenarios | F    | 전면 누락 (규칙 위반)             |
| Test Plan                     | D    | generic 3줄 수준                  |
| Done Gate 정의                | F    | 정의 불가 상태                    |
| 기술 리스크 식별              | C    | DTS 불일치 언급했으나 해결책 없음 |
| PoC 구체성                    | D    | 기준/성공조건 없음                |

**핵심 결론**: `## 검증` 섹션이 `backlog-execution.md`가 명시적으로 금지하는 항목(빌드/typecheck/lint 통과)만 포함하고 있다. 이는 단순 누락이 아니라 규칙 직접 위반이다. blocked 상태이므로 즉각 수정 압박은 낮지만, 해제 전에 백로그 구조부터 규칙에 맞게 재작성해야 한다.

---

## Test Plan

이 문서는 리뷰/분석 문서이며 구현 변경 없음. 리뷰 완성도 검증:

- 원본 태스크 파일(INFRA-BL-009-build-tool-migration.md)을 참조해 각 섹션의 지적 사항이 실제 누락 항목과 일치하는지 확인
- 종합 리뷰(review-INFRA-BL-009-synthesis.md)의 결론과 일관성 확인
- `pnpm harness:scan` 실행 시 이 파일이 scan 대상에 포함되어 오류 없이 통과하는지 확인
