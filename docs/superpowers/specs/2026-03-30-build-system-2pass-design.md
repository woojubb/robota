# Build System 2-Pass Design (INFRA-BL-008)

## Problem

`pnpm build` intermittently fails because tsup runs ESM/CJS bundling and DTS generation as a single command. When pnpm starts a dependent package before its dependency's DTS is ready, the DTS build fails with "Could not find a declaration file" errors.

Consistent in CI, intermittent locally. Blocks deployments.

## Solution

Split the root `pnpm build` into two sequential phases while keeping tsup as the build tool.

### Phase 1 — JS Bundling (parallel, fast)

```
pnpm --filter "./packages/**" build:js
```

Each package runs `tsup --no-dts` or `tsup <entry> --format esm,cjs --out-dir dist/node --clean` (no `--dts`). No cross-package type dependency needed — esbuild resolves imports without `.d.ts` files.

### Phase 2 — DTS Generation (topological order)

```
pnpm --filter "./packages/**" build:types
```

Each package runs `tsup --dts-only` or `tsup <entry> --dts-only --out-dir dist/node`. By this point all JS is built, and pnpm runs packages in topological order so each package's dependency DTS is ready.

### Root Build Script

```json
"build": "pnpm --filter \"./packages/**\" build:js && pnpm --filter \"./packages/**\" build:types"
```

The `&&` ensures Phase 2 only starts after all Phase 1 builds complete.

## Package Script Patterns

### Pattern 1 — Inline tsup (30 packages)

```json
"build": "tsup src/index.ts --format esm,cjs --dts --out-dir dist/node --clean",
"build:js": "tsup src/index.ts --format esm,cjs --out-dir dist/node --clean",
"build:types": "tsup src/index.ts --dts-only --out-dir dist/node"
```

### Pattern 2 — tsup config (8 packages: agent-core, agent-sessions, agent-provider-\*, agent-team, agent-playground)

```json
"build": "tsup",
"build:js": "tsup --no-dts",
"build:types": "tsup --dts-only"
```

### Pattern 3 — agent-cli (1 package, special case)

```json
"build": "tsup src/index.ts src/bin.ts --format esm,cjs --dts --out-dir dist/node --clean && rm -f dist/node/bin.cjs dist/node/bin.d.cts",
"build:js": "tsup src/index.ts src/bin.ts --format esm,cjs --out-dir dist/node --clean && rm -f dist/node/bin.cjs",
"build:types": "tsup src/index.ts src/bin.ts --dts-only --out-dir dist/node && rm -f dist/node/bin.d.cts"
```

## What Does NOT Change

- Individual `pnpm --filter <pkg> build` still works (runs JS + DTS together)
- `pnpm publish:beta` workflow unchanged
- tsup config files unchanged
- tsconfig files unchanged
- No new dependencies added

## Impact

- **Modified files:** 48 package.json (add 2 scripts each) + root package.json (change build script)
- **Risk:** Low — only script additions, no logic changes
- **Rollback:** Revert root build script to original single-pass command

## Verification

1. `pnpm build` passes with 0 errors (run 3+ times to confirm no intermittent failures)
2. `pnpm --filter @robota-sdk/dag-adapters-local build` still works individually
3. CI build passes

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
