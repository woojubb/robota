# dag-adapters-local 패키지 분리 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** dag-core/src/testing/의 인메모리 포트 구현체들을 독립 패키지 `@robota-sdk/dag-adapters-local`로 분리하여 dag-core를 순수 계약 패키지로 정리한다.

**Architecture:** dag-core에서 testing/ 디렉토리를 새 패키지로 이동. 기존 import 경로를 모두 새 패키지로 변경. dag-core에는 deprecated re-export를 일시적으로 유지하지 않고 깨끗하게 제거한다.

**Tech Stack:** TypeScript, pnpm workspace, Vitest

---

## Task 1: dag-adapters-local 패키지 scaffold

**Files:**
- Create: `packages/dag-adapters-local/package.json`
- Create: `packages/dag-adapters-local/tsconfig.json`
- Create: `packages/dag-adapters-local/src/index.ts`

**Step 1: Scaffold package**

기존 패키지 구조 참조 (예: `packages/dag-cost/package.json`, `packages/dag-cost/tsconfig.json`).

```json
{
  "name": "@robota-sdk/dag-adapters-local",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/node/index.cjs",
  "module": "./dist/node/index.js",
  "types": "./dist/node/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/node/index.js",
      "require": "./dist/node/index.cjs",
      "types": "./dist/node/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --out-dir dist/node --clean",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "@robota-sdk/dag-core": "workspace:*"
  }
}
```

devDependencies는 기존 패키지 패턴에 맞춰 설정 (vitest, tsup, rimraf, typescript).

**Step 2: Create empty index.ts**

```typescript
// Will be populated in Task 2
```

**Step 3: Run pnpm install**

Run: `pnpm install`
Expected: New package recognized in workspace

**Step 4: Commit**

```bash
git add packages/dag-adapters-local/
git commit -m "feat(dag-adapters-local): scaffold package"
```

---

## Task 2: 구현체 파일 이동

**Files:**
- Move: `packages/dag-core/src/testing/in-memory-storage-port.ts` → `packages/dag-adapters-local/src/in-memory-storage-port.ts`
- Move: `packages/dag-core/src/testing/in-memory-queue-port.ts` → `packages/dag-adapters-local/src/in-memory-queue-port.ts`
- Move: `packages/dag-core/src/testing/in-memory-lease-port.ts` → `packages/dag-adapters-local/src/in-memory-lease-port.ts`
- Move: `packages/dag-core/src/testing/fake-clock-port.ts` → `packages/dag-adapters-local/src/clock-ports.ts`
- Move: `packages/dag-core/src/testing/mock-task-executor-port.ts` → `packages/dag-adapters-local/src/mock-task-executor-port.ts`
- Move: `packages/dag-core/src/testing/stub-prompt-backend.ts` → `packages/dag-adapters-local/src/stub-prompt-backend.ts`
- Modify: `packages/dag-adapters-local/src/index.ts` (barrel export)
- Delete: `packages/dag-core/src/testing/` (entire directory)
- Modify: `packages/dag-core/src/index.ts` (remove testing re-exports)

**Step 1: Copy files to new package**

각 파일을 새 패키지로 복사. import 경로에서 `@robota-sdk/dag-core` 참조는 그대로 유지 (외부 의존성으로 올바름).

`fake-clock-port.ts`는 `clock-ports.ts`로 rename (FakeClockPort + SystemClockPort 둘 다 포함하므로).

**Step 2: Update imports in moved files**

각 파일의 내부 import를 확인. dag-core 타입 import는 `@robota-sdk/dag-core`로 유지 (이미 그럴 가능성 높음). 상대 경로 import가 있으면 조정.

**Step 3: Create barrel export**

```typescript
// packages/dag-adapters-local/src/index.ts
export { InMemoryStoragePort } from './in-memory-storage-port.js';
export { InMemoryQueuePort } from './in-memory-queue-port.js';
export { InMemoryLeasePort } from './in-memory-lease-port.js';
export { FakeClockPort, SystemClockPort } from './clock-ports.js';
export { MockTaskExecutorPort } from './mock-task-executor-port.js';
export { createStubPromptBackend } from './stub-prompt-backend.js';
```

**Step 4: Remove testing/ from dag-core**

- Delete `packages/dag-core/src/testing/` 전체 디렉토리
- `packages/dag-core/src/index.ts`에서 testing 관련 re-export 제거

**Step 5: Build new package**

Run: `pnpm --filter @robota-sdk/dag-adapters-local build`
Expected: Pass

**Step 6: Commit**

```bash
git add packages/dag-adapters-local/ packages/dag-core/
git commit -m "refactor: move in-memory adapters from dag-core to dag-adapters-local"
```

---

## Task 3: dag-core 내부 테스트 import 수정

**Files:**
- Modify: `packages/dag-core/package.json` (add devDependency on dag-adapters-local)
- Modify: All test files in `packages/dag-core/src/__tests__/` that import from `../testing/`

**Step 1: Add devDependency**

```json
"devDependencies": {
  "@robota-sdk/dag-adapters-local": "workspace:*"
}
```

Run: `pnpm install`

**Step 2: Update test imports**

모든 dag-core 테스트에서:

```typescript
// Before
import { InMemoryStoragePort } from '../testing/in-memory-storage-port.js';
// 또는
import { InMemoryStoragePort } from '../testing/index.js';

// After
import { InMemoryStoragePort } from '@robota-sdk/dag-adapters-local';
```

grep으로 모든 참조 찾기:
```bash
grep -r "from.*testing" packages/dag-core/src/__tests__/
grep -r "from.*testing" packages/dag-core/src/
```

**Step 3: Run dag-core tests**

Run: `pnpm --filter @robota-sdk/dag-core test`
Expected: All 219 tests pass

**Step 4: Commit**

```bash
git add packages/dag-core/
git commit -m "refactor(dag-core): update test imports to use dag-adapters-local"
```

---

## Task 4: 외부 패키지 import 수정 (dag-* packages)

**Files:**
- Modify: All packages that import from `@robota-sdk/dag-core` testing exports

Packages to check (grep results from research):
- `packages/dag-runtime/` — tests
- `packages/dag-worker/` — tests
- `packages/dag-scheduler/` — tests
- `packages/dag-projection/` — tests
- `packages/dag-node/` — tests
- `packages/dag-api/` — tests
- `packages/dag-orchestrator/` — tests
- `packages/dag-cost/` — tests (if any)

**Step 1: Find all external imports**

```bash
grep -r "@robota-sdk/dag-core.*testing\|@robota-sdk/dag-core.*InMemory\|@robota-sdk/dag-core.*FakeClock\|@robota-sdk/dag-core.*SystemClock\|@robota-sdk/dag-core.*MockTask\|@robota-sdk/dag-core.*StubPrompt" packages/ --include="*.ts" -l
```

**Step 2: For each package found**

1. Add `"@robota-sdk/dag-adapters-local": "workspace:*"` to devDependencies (테스트에서만 사용하므로 devDep)
2. Update import paths:

```typescript
// Before
import { InMemoryStoragePort, SystemClockPort } from '@robota-sdk/dag-core';

// After
import { InMemoryStoragePort, SystemClockPort } from '@robota-sdk/dag-adapters-local';
```

주의: 일부 패키지는 dag-core에서 타입과 어댑터를 한 줄로 import할 수 있음. 이 경우 두 줄로 분리:

```typescript
// Before
import { type IStoragePort, InMemoryStoragePort } from '@robota-sdk/dag-core';

// After
import type { IStoragePort } from '@robota-sdk/dag-core';
import { InMemoryStoragePort } from '@robota-sdk/dag-adapters-local';
```

**Step 3: Run pnpm install**

**Step 4: Run all package tests**

Run: `pnpm test`
Expected: All pass

**Step 5: Commit**

```bash
git add packages/
git commit -m "refactor: update all dag-* package imports to use dag-adapters-local"
```

---

## Task 5: 앱 import 수정 (servers + web)

**Files:**
- Modify: `apps/dag-orchestrator-server/src/server.ts`
- Modify: `apps/dag-orchestrator-server/package.json`
- Modify: `apps/dag-runtime-server/src/server.ts`
- Modify: `apps/dag-runtime-server/package.json`
- Modify: Any other app files that import in-memory adapters

**Step 1: Find all app imports**

```bash
grep -r "InMemoryStoragePort\|InMemoryQueuePort\|InMemoryLeasePort\|SystemClockPort\|FakeClockPort" apps/ --include="*.ts" -l
```

**Step 2: Update app dependencies**

앱에서는 **dependencies** (devDependencies 아님) — 프로덕션 서버에서 실제로 사용하므로:

```json
"dependencies": {
  "@robota-sdk/dag-adapters-local": "workspace:*"
}
```

**Step 3: Update imports in server files**

```typescript
// Before (dag-orchestrator-server/src/server.ts)
import { InMemoryStoragePort } from '@robota-sdk/dag-core';

// After
import { InMemoryStoragePort, InMemoryQueuePort, InMemoryLeasePort, SystemClockPort } from '@robota-sdk/dag-adapters-local';
```

**Step 4: Update app test files too**

```bash
grep -r "InMemoryStoragePort\|InMemoryQueuePort\|InMemoryLeasePort\|SystemClockPort" apps/ --include="*.test.ts" -l
```

**Step 5: Run full build and test**

Run: `pnpm build && pnpm test`
Expected: All pass

**Step 6: Commit**

```bash
git add apps/
git commit -m "refactor: update app imports to use dag-adapters-local"
```

---

## Task 6: dag-core SPEC.md 및 프로젝트 구조 업데이트

**Files:**
- Modify: `packages/dag-core/docs/SPEC.md` (testing section 제거/업데이트)
- Modify: `.agents/project-structure.md` (새 패키지 추가)
- Create: `packages/dag-adapters-local/docs/SPEC.md` (최소 스펙)

**Step 1: Update dag-core SPEC.md**

- testing/ 관련 섹션에서 "인메모리 구현체는 `@robota-sdk/dag-adapters-local`로 이동됨" 명시
- Class Contract Registry에서 testing 구현체 항목 제거

**Step 2: Update project-structure.md**

새 패키지 추가:
```markdown
| dag-adapters-local | 인메모리 포트 어댑터 (Storage, Queue, Lease, Clock) | dag-core |
```

**Step 3: Create minimal SPEC.md for dag-adapters-local**

**Step 4: Final full build + test**

Run: `pnpm build && pnpm test`
Expected: All pass, zero `@robota-sdk/dag-core` testing imports remaining

**Step 5: Verify no stale imports**

```bash
grep -r "dag-core.*testing\|dag-core/testing" packages/ apps/ --include="*.ts"
```
Expected: Zero results

**Step 6: Commit**

```bash
git add .
git commit -m "docs: update SPEC.md and project structure for dag-adapters-local"
```

---

## Task Dependencies

```
Task 1 (scaffold) → Task 2 (move files) → Task 3 (dag-core tests) → Task 4 (packages) → Task 5 (apps) → Task 6 (docs)
```

All tasks are sequential — each depends on the previous.

## Verification Checklist

After all tasks:
- [ ] `grep -r "dag-core.*testing" packages/ apps/ --include="*.ts"` returns 0 results
- [ ] `packages/dag-core/src/testing/` directory does not exist
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes (all 2,545+ tests)
- [ ] `packages/dag-adapters-local/` builds and exports all 6 implementations
- [ ] dag-core SPEC.md updated
- [ ] project-structure.md updated
