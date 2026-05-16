# Build Tool Migration Design: tsup → tsdown

작성일: 2026-05-16  
상태: 초안 (Phase 0 완료)  
관련 백로그: INFRA-BL-009

---

## 1. 결정: tsdown 선택

### 근거

INFRA-BL-009-B Prior Art Research 및 INFRA-BL-009-D PoC 결과:

| 기준              | tsdown 0.22.0     | unbuild 3.6.1 | tsup 8.5.1 (현재) |
| ----------------- | ----------------- | ------------- | ----------------- |
| 유지보수 상태     | Active ✅         | Active ✅     | 비유지보수 ❌     |
| browser dual 빌드 | Yes ✅            | Partial ⚠️    | Yes ✅            |
| `.d.ts` 강제 출력 | outExtensions ✅  | 불가 ❌       | 불가 ❌           |
| DTS-only 패스     | `--dts` (간접) ✅ | Partial ⚠️    | `--dts-only` ✅   |
| tsup 마이그레이션 | 낮음 ✅           | 높음 ❌       | N/A               |
| TypeScript 6      | Yes ✅            | Yes ✅        | Broken ❌         |

**선택: tsdown** — drop-in 교체 가능, `.d.ts` 출력 계약 보존 가능, tsup 공식 후속 도구.

### PoC 결과 (agent-plugin-limits, 2026-05-16)

- ✅ 계약 충족: `dist/node/index.js`, `index.cjs`, `index.d.ts` 생성, `.d.mts` 없음
- ✅ 빌드 속도: 250ms (tsup 대비 동등 또는 빠름)
- ✅ harness:scan 통과, 45개 테스트 통과, typecheck 통과
- ⚠️ ESM sourcemap 억제 미작동 (`sourcemap: false` 설정에도 `index.js.map` 생성) — Phase 1 전 해결 필요
- ⚠️ `--dts-only` CLI 플래그 없음 — `build:types`는 `tsdown --dts`로 대체

---

## 2. 패키지 유형 분류

전체 54개 빌드 계약 패키지를 4가지 유형으로 분류한다.

### 유형 A: node-only simple

특징: ESM+CJS, 단일 entry, 브라우저 빌드 없음, bin 없음, sub-path 없음

tsdown 기본 config 템플릿 사용 가능:

```ts
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  outDir: 'dist/node',
  platform: 'node',
  clean: true,
  dts: true,
  sourcemap: false,
  treeshake: true,
  minify: true,
  outExtensions: ({ format }) => ({
    js: format === 'cjs' ? '.cjs' : '.js',
    dts: '.d.ts',
  }),
  deps: { neverBundle: [/^@robota-sdk\/.*/] },
});
```

패키지 목록 (40개):

- agent-command-agent, background, compact, context, exit, help, language, memory, mode, model, permissions, plugin, provider, reset, rewind, session, settings, skills, statusline, user-local
- agent-framework, agent-interface-transport
- agent-executor, agent-session
- agent-plugin-conversation-history, error-handling, execution-analytics, limits (완료), logging, performance, usage, webhook
- agent-remote-client
- agent-tool-mcp
- agent-transport-headless, http, mcp, tui, ws

### 유형 B: browser dual build

특징: node 빌드 + browser 빌드 두 개 entry, `platform: 'browser'` 설정 포함

tsdown config에서 배열 형태 사용:

```ts
export default defineConfig([
  {
    // Node build
    entry: ['src/index.ts'],
    outDir: 'dist/node',
    platform: 'node',
    format: ['esm', 'cjs'],
    dts: true,
    ...
  },
  {
    // Browser build
    entry: ['src/index.ts'],
    outDir: 'dist/browser',
    platform: 'browser',
    format: ['esm'],
    dts: true,
    ...
  },
]);
```

패키지 목록 (11개):

- agent-core
- agent-provider-anthropic, bytedance, deepseek, gemini, gemma, google, openai-compatible, qwen
- agent-team, agent-tools
- agent-playground

### 유형 B2: browser dual + React externals

특징: 유형 B에 추가로 `react`, `react-dom` external 필요

패키지 목록 (2개):

- agent-web-ui
- agent-provider-openai (browser build + loggers sub-path)

### 유형 C: bin entry

특징: bin 항목 포함, CLI 실행 파일 출력

tsdown config에 `exe: true` 또는 적절한 shebang 설정 필요:

```ts
export default defineConfig({
  entry: { 'bin/robota': 'src/bin.ts' },
  outDir: 'dist',
  format: ['esm'],
  exe: true,
  ...
});
```

패키지 목록 (1개):

- agent-cli (bin + sub-path exports)

### 유형 D: sub-path exports (bin 없음)

특징: 메인 entry 외 추가 sub-path entry 포함 (loggers 등)

패키지 목록 (1개):

- agent-provider-openai (node + browser + loggers sub-path)

> 참고: agent-provider-openai는 유형 B2 + D의 복합 패키지

---

## 3. 마이그레이션 5단계 계획

각 Phase는 독립 PR이며 이전 Phase의 `pnpm harness:scan` 통과가 선행 조건이다.

### Phase 0 (완료): 사전 준비

- [x] INFRA-BL-009-C: harness build output contract guard 추가
- [x] INFRA-BL-009-D: tsdown PoC on agent-plugin-limits
- [x] 설계 문서 작성 (이 문서)
- [ ] sourcemap 억제 문제 해결 (tsdown `sourcemap: false` 동작 확인 후)
- [ ] 사용자 승인

### Phase 1: 유형 A — node-only simple 패키지

대상: 40개 패키지 (bin/browser/sub-path 없음)

세부 단계:

1. `scripts/templates/tsdown.config.node-only.ts` 공통 템플릿 작성
2. 각 패키지에 tsdown.config.ts 추가
3. package.json 스크립트 업데이트 (`tsup` → `tsdown`)
4. devDependencies 교체 (`tsup` → `tsdown ^0.22.0`)
5. `pnpm --filter <pkg> build && harness:scan` 검증

### Phase 2: 유형 B — browser dual build 패키지

대상: 11개 + B2 패키지

세부 단계:

1. browser dual config 템플릿 작성
2. 각 패키지의 tsup.config.ts → tsdown.config.ts 변환
3. 브라우저 빌드 출력 검증 (dist/browser/ 경로 보존)
4. `pnpm harness:scan` 통과 확인

### Phase 3: 유형 C — bin entry 패키지

대상: agent-cli

세부 단계:

1. `exe: true` 설정으로 shebang 처리 확인
2. sub-path exports 빌드 검증
3. 실제 CLI 실행 테스트

### Phase 4: agent-provider-openai (유형 B2+D)

대상: agent-provider-openai (복합 패키지)

세부 단계:

1. node + browser + loggers 세 가지 빌드 entry 설정
2. loggers sub-path 출력 경로 보존 확인

### Phase 5: apps/ 패키지

대상: apps/agent-server (빌드 구조 다름)

참고: apps/agent-web은 Vite 사용으로 tsup/tsdown 무관

---

## 4. tsdown.config.ts 표준 템플릿

### node-only 패키지

```ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  outDir: 'dist/node',
  platform: 'node',
  clean: true,
  dts: true,
  sourcemap: false,
  treeshake: true,
  minify: true,
  outExtensions: ({ format }) => ({
    js: format === 'cjs' ? '.cjs' : '.js',
    dts: '.d.ts',
  }),
  deps: {
    neverBundle: [/^@robota-sdk\/.*/],
  },
});
```

package.json 스크립트:

```json
{
  "build": "tsdown",
  "build:js": "tsdown --no-dts",
  "build:types": "tsdown --dts"
}
```

### browser dual 패키지 (provider 계열)

```ts
import { defineConfig } from 'tsdown';

const external = [/^@robota-sdk\/.*/, '<provider-sdk>'];
const outExtensions = ({ format }) => ({
  js: format === 'cjs' ? '.cjs' : '.js',
  dts: '.d.ts',
});
const baseConfig = {
  clean: true,
  sourcemap: false,
  treeshake: true,
  minify: true,
  outExtensions,
};

export default defineConfig([
  {
    ...baseConfig,
    entry: ['src/index.ts'],
    outDir: 'dist/node',
    format: ['esm', 'cjs'],
    platform: 'node',
    dts: true,
    deps: { neverBundle: external },
  },
  {
    ...baseConfig,
    entry: ['src/index.ts'],
    outDir: 'dist/browser',
    format: ['esm'],
    platform: 'browser',
    dts: true,
    deps: { neverBundle: external },
  },
]);
```

---

## 5. 알려진 이슈 및 해결 계획

### 이슈 1: ESM sourcemap 억제 미작동

- 현상: `sourcemap: false` 설정에도 `dist/node/index.js.map` (22kB) 생성
- 영향: 번들 크기 증가 (계약 위반 아님)
- 해결: tsdown GitHub에 이슈 리포트 후 버전 업그레이드 또는 workaround 적용
- Phase 1 시작 전 해결 필요

### 이슈 2: `--dts-only` CLI 플래그 없음

- 현상: `tsdown --dts-only` 플래그 없음. `build:types` 스크립트에서 JS도 재빌드됨
- 영향: build:types 단계에서 JS 빌드 중복 실행 (비효율, 계약 위반 아님)
- 해결: tsdown 이후 버전에서 지원 시 업데이트. 현재는 `tsdown --dts`로 유지

### 이슈 3: `external` 옵션 deprecated

- 현상: `external` 옵션 사용 시 deprecation 경고
- 해결: `deps.neverBundle` 옵션으로 교체 (PoC에서 이미 적용)

---

## 6. 롤백 절차

각 Phase 단위로 롤백 가능:

```bash
# 단일 패키지 롤백 예시
cd packages/<pkg>
# tsdown.config.ts 제거 (tsup 사용 안 했으면 불필요)
rm tsdown.config.ts
# package.json 스크립트 복원
# devDependencies에서 tsdown 제거, tsup 재추가
```

참고: agent-plugin-limits는 이미 tsdown으로 전환됨. 롤백 시 해당 PR revert 사용.

---

## 7. 마이그레이션 후 갱신 대상

- `.agents/tasks/INFRA-BL-009-build-tool-migration.md`: status done으로 종결
- 각 패키지의 `tsup.config.ts` → `tsdown.config.ts` 교체
- `scripts/build-types-ordered.mjs`: tsdown의 DTS 빌드 커맨드로 업데이트
- 루트 `package.json` devDependencies: `tsup` 제거, `tsdown` 추가

---

## 8. 사용자 결정 게이트

다음 항목에 대해 사용자 승인 후 Phase 1 시작:

1. tsdown 0.22.x (현재 버전)로 진행 vs tsdown 1.0 출시 대기
2. 전체 일괄 마이그레이션 vs 단계적 마이그레이션 (권장: 단계적)
3. sourcemap 이슈 해결 방법 (무시 vs tsdown 이슈 제보 대기)
