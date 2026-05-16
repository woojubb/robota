---
title: 'INFRA-BL-009-E: unbuild PoC — auth/credits 패키지 마이그레이션 검증 (tsdown 비교군)'
status: skipped
completed: 2026-05-16
created: 2026-05-15
priority: low
urgency: later
area: packages/auth, packages/credits
depends_on:
  - INFRA-BL-009-A
  - INFRA-BL-009-B
  - INFRA-BL-009-C
skip-reason: |
  INFRA-BL-009-B Prior Art Research에서 unbuild 3.6.1 분석 완료.
  결론: browser/node dual build 지원 불충분, DTS 확장자 .d.ts 강제 불가,
  마이그레이션 비용 높음. tsdown이 명확한 우위. 별도 PoC 불필요.
  INFRA-BL-009-F는 INFRA-BL-009-D 성공으로 unblocked (D OR E 조건).
---

## 배경

INFRA-BL-009-D (tsdown PoC)와 동일 패키지에서 unbuild 3.6.1로 비교 PoC를 수행한다. unbuild는 안정 릴리즈(3.6.1)이므로 tsdown 1.0 출시와 무관하게 진행할 수 있다.

두 도구를 비교해야 합리적인 도구 선정 Decision Matrix를 완성할 수 있다.

## PoC 실행 계획

### 단계 1: unbuild 설치 및 config 작성

```bash
pnpm add -D unbuild --filter @robota-sdk/auth
```

```ts
// packages/auth/build.config.ts
import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  entries: ['src/index'],
  outDir: 'dist/node',
  declaration: true,
  rollup: {
    emitCJS: true,
    output: {
      exports: 'named',
      // CJS 파일 확장자 제어
      chunkFileNames: '[name].cjs',
    },
  },
  externals: [/^@robota-sdk\/.*/, 'zod'],
});
```

### 단계 2: package.json scripts 업데이트

```json
{
  "scripts": {
    "build": "unbuild",
    "build:js": "unbuild --stub",
    "build:types": "unbuild"
  }
}
```

주의: unbuild는 tsup/tsdown의 `--no-dts`, `--dts-only` 개념과 다르다. `build:js`와 `build:types` 분리 전략이 다를 수 있으며, `build-types-ordered.mjs`와의 호환성 확인 필수.

### 단계 3: 기존 tsup.config.ts 보존

```bash
cp packages/auth/tsup.config.ts packages/auth/tsup.config.ts.bak
```

### 단계 4: 빌드 실행 및 검증

```bash
pnpm --filter @robota-sdk/auth build
```

### 성공 기준 체크리스트

```
[ ] packages/auth/dist/node/index.js 또는 index.mjs 존재
    (mjs이면 exports 필드 및 main 필드 수정 필요 여부 기록)
[ ] packages/auth/dist/node/index.cjs 존재
[ ] packages/auth/dist/node/index.d.ts 존재 (.d.mts 아님)
[ ] node -e "require('./packages/auth/dist/node/index.cjs')" 성공
[ ] TypeScript에서 import 타입 resolution 성공 (tsc --noEmit)
[ ] pnpm harness:scan (check-build-output-contracts) 통과
[ ] build:types (DTS-only 또는 동등 전략) 동작 확인
[ ] 빌드 시간 tsup/tsdown 대비 측정 및 기록
```

### 실패 기준

- DTS 파일 확장자가 .d.mts로 생성되고 우회 불가
- dist/node/ 하위 경로 구조 제어 불가
- build-types-ordered.mjs와 호환되는 DTS-only 빌드 전략 없음
- harness scan 실패

## INFRA-BL-009-D 대비 비교 기록

| 항목                   | tsdown | unbuild |
| ---------------------- | ------ | ------- |
| 출력 경로 구조         |        |         |
| DTS 확장자             |        |         |
| DTS-only 빌드 지원     |        |         |
| browser dual 빌드 가능 |        |         |
| 빌드 시간              |        |         |
| config 복잡도          |        |         |
| harness 통과           |        |         |

## Test Plan

- [ ] PoC 시작 전 tsup 빌드 결과 스냅샷 저장 (비교 기준)
- [ ] 성공 기준 체크리스트 항목별 실행 결과 기록
- [ ] INFRA-BL-009-D와의 비교 표 완성
- [ ] 실패 시 롤백 후 tsup으로 빌드 성공 확인
- [ ] Decision Matrix 업데이트

## User Execution Test Scenarios

### 시나리오 1: unbuild 빌드 출력 계약 검증

- agent-executability: agent-executable
- 전제조건: unbuild 설치 완료, build.config.ts 작성 완료
- 명령:
  ```bash
  cd /Users/jungyoun/Documents/dev/robota
  pnpm --filter @robota-sdk/auth build
  ls packages/auth/dist/node/
  node -e "const m = require('./packages/auth/dist/node/index.cjs'); console.log('CJS OK:', typeof m)"
  ```
- 예상 결과:
  ```
  index.js  index.cjs  index.d.ts
  CJS OK: object
  ```
- 증거: [구현 후 기록]

### 시나리오 2: harness scan 통과 확인

- agent-executability: agent-executable
- 명령:
  ```bash
  pnpm harness:scan
  ```
- 예상 결과: check-build-output-contracts 포함 전체 harness scan 통과
- 증거: [구현 후 기록]
