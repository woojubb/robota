---
title: 'INFRA-BL-009-D: tsdown PoC — auth/credits 패키지 마이그레이션 검증'
status: todo
created: 2026-05-15
priority: low
urgency: later
area: packages/auth, packages/credits
depends_on:
  - INFRA-BL-009-A
  - INFRA-BL-009-B
  - INFRA-BL-009-C
blocked-by: tsdown 1.0 미출시 또는 INFRA-BL-009-B의 outExtensions 지원 확인 완료 전
---

## 배경

INFRA-BL-009-B (Prior Art Research)에서 tsdown이 현재 export 계약을 보존할 수 있음이 확인된 경우 PoC를 진행한다.

대상 패키지로 `packages/auth`와 `packages/credits`를 선정한 이유:

- 최소 내부 의존성 (leaf 패키지)
- node-only 빌드 (browser dual 없음) — 가장 단순한 케이스
- bin entry 없음
- 실패 시 영향 범위 최소

## PoC 실행 계획

### 단계 1: tsdown 설치 및 config 작성

```bash
pnpm add -D tsdown --filter @robota-sdk/auth
```

```ts
// packages/auth/tsdown.config.ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist/node',
  format: ['esm', 'cjs'],
  dts: true,
  // 계약 보존: .d.mts 대신 .d.ts
  outExtensions: ({ format }) => ({
    js: format === 'cjs' ? '.cjs' : '.js',
    dts: '.d.ts',
  }),
  clean: true,
  external: [/^@robota-sdk\/.*/, 'zod'],
});
```

### 단계 2: package.json scripts 업데이트

```json
{
  "scripts": {
    "build": "tsdown",
    "build:js": "tsdown --no-dts",
    "build:types": "tsdown --dts-only"
  }
}
```

주의: `--dts-only` 플래그가 tsdown에 존재하지 않으면 INFRA-BL-009-B에서 대안 확인 필요.

### 단계 3: 기존 tsup.config.ts 보존

```bash
cp packages/auth/tsup.config.ts packages/auth/tsup.config.ts.bak
```

롤백 시 복원: `mv packages/auth/tsup.config.ts.bak packages/auth/tsup.config.ts`

### 단계 4: 빌드 실행 및 검증

```bash
pnpm --filter @robota-sdk/auth build
```

### 성공 기준 체크리스트

```
[ ] packages/auth/dist/node/index.js 존재
[ ] packages/auth/dist/node/index.cjs 존재
[ ] packages/auth/dist/node/index.d.ts 존재 (.d.mts 아님)
[ ] node -e "require('./packages/auth/dist/node/index.cjs')" 성공
[ ] node -e "import('./packages/auth/dist/node/index.js')" 성공
[ ] TypeScript에서 import 타입 resolution 성공 (tsc --noEmit)
[ ] pnpm harness:scan (check-build-output-contracts) 통과
[ ] 빌드 시간 tsup 대비 측정 및 기록
```

### 실패 기준

다음 중 하나라도 해당하면 PoC 실패로 기록하고 unbuild PoC(INFRA-BL-009-E)로 전환:

- DTS 파일 확장자가 .d.mts로 생성됨
- dist/node/ 하위 경로 구조 유지 불가
- `build:types` (DTS-only) 모드 미지원
- harness scan 실패

## Test Plan

- [ ] PoC 시작 전 tsup 빌드 결과 스냅샷 저장 (비교 기준)
- [ ] 성공 기준 체크리스트 항목별 실행 결과 기록
- [ ] 빌드 시간 비교 (time pnpm --filter @robota-sdk/auth build)
- [ ] 실패 시 롤백 후 tsup으로 빌드 성공 확인

## User Execution Test Scenarios

### 시나리오 1: tsdown 빌드 출력 계약 검증

- agent-executability: agent-executable
- 전제조건: tsdown 설치 완료, tsdown.config.ts 작성 완료
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

### 시나리오 3: 빌드 성능 비교

- agent-executability: agent-executable
- 명령:

  ```bash
  # tsdown 빌드 시간
  time pnpm --filter @robota-sdk/auth build

  # tsup 빌드 시간 (롤백 후)
  mv packages/auth/tsup.config.ts.bak packages/auth/tsup.config.ts
  time pnpm --filter @robota-sdk/auth build
  ```

- 예상 결과: 빌드 시간 기록 (tsdown이 더 빠르거나 동등)
- 증거: [구현 후 기록]
