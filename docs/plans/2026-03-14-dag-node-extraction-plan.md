# dag-node Package Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract node authoring infrastructure from `dag-core` into a new `@robota-sdk/dag-node` package with proper SPEC and contract tests.

**Architecture:** Move 10 source files + 9 test files (122 tests) from `dag-core` to a new `dag-node` package. Port definition helpers (`createBinaryPortDefinition`, `BINARY_PORT_PRESETS`) are extracted from `domain.ts`. `dag-core` re-exports all moved symbols for backward compatibility. All 10 `dag-nodes/*` packages update their imports.

**Tech Stack:** TypeScript 5.3.3, tsup, vitest, pnpm workspace, zod

**Test Strategy:** No new tests needed — this is a code move. Verification is: (1) all 122 moved tests pass in `dag-node`, (2) all existing `dag-core` tests still pass, (3) all `dag-nodes/*` tests pass, (4) full `pnpm typecheck` and `pnpm test` pass.

---

### Task 1: Scaffold `packages/dag-node` package

**Files:**
- Create: `packages/dag-node/package.json`
- Create: `packages/dag-node/tsconfig.json`
- Create: `packages/dag-node/src/index.ts` (empty barrel)

**Step 1: Create package.json**

```json
{
  "name": "@robota-sdk/dag-node",
  "version": "3.0.0",
  "description": "Node authoring infrastructure for Robota DAG system",
  "type": "module",
  "main": "dist/node/index.js",
  "module": "dist/node/index.mjs",
  "types": "dist/node/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/node/index.js",
      "require": "./dist/node/index.cjs",
      "types": "./dist/node/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --out-dir dist/node --clean",
    "dev": "tsup src/index.ts --format esm,cjs --dts --out-dir dist/node --watch",
    "clean": "rimraf dist",
    "test": "vitest run --passWithNoTests",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "@robota-sdk/dag-core": "workspace:*",
    "zod": "^3.24.4",
    "zod-to-json-schema": "^3.24.5"
  },
  "devDependencies": {
    "eslint": "^8.56.0",
    "rimraf": "^5.0.5",
    "tsup": "^8.0.1",
    "typescript": "^5.3.3",
    "vitest": "^1.6.1"
  }
}
```

**Step 2: Create tsconfig.json**

Same as dag-core's tsconfig.json (extends `../../tsconfig.base.json`).

**Step 3: Create empty src/index.ts**

```typescript
// @robota-sdk/dag-node
// Node authoring infrastructure for the Robota DAG system.
```

**Step 4: Run pnpm install**

Run: `pnpm install`
Expected: lockfile updated, no errors.

**Step 5: Verify build**

Run: `pnpm --filter @robota-sdk/dag-node build`
Expected: Build success.

**Step 6: Commit**

```bash
git add packages/dag-node/
git commit -m "chore(dag-node): scaffold empty package"
```

---

### Task 2: Move source files to dag-node

**Files:**
- Move: `packages/dag-core/src/lifecycle/abstract-node-definition.ts` → `packages/dag-node/src/lifecycle/abstract-node-definition.ts`
- Move: `packages/dag-core/src/lifecycle/node-io-accessor.ts` → `packages/dag-node/src/lifecycle/node-io-accessor.ts`
- Move: `packages/dag-core/src/lifecycle/registered-node-lifecycle.ts` → `packages/dag-node/src/lifecycle/registered-node-lifecycle.ts`
- Move: `packages/dag-core/src/lifecycle/binary-value-parser.ts` → `packages/dag-node/src/lifecycle/binary-value-parser.ts`
- Move: `packages/dag-core/src/lifecycle/static-node-lifecycle-factory.ts` → `packages/dag-node/src/lifecycle/static-node-lifecycle-factory.ts`
- Move: `packages/dag-core/src/lifecycle/default-node-task-handlers.ts` → `packages/dag-node/src/lifecycle/default-node-task-handlers.ts`
- Move: `packages/dag-core/src/registry/static-node-manifest-registry.ts` → `packages/dag-node/src/registry/static-node-manifest-registry.ts`
- Move: `packages/dag-core/src/value-objects/media-reference.ts` → `packages/dag-node/src/value-objects/media-reference.ts`
- Move: `packages/dag-core/src/schemas/media-reference-schema.ts` → `packages/dag-node/src/schemas/media-reference-schema.ts`
- Move: `packages/dag-core/src/utils/node-descriptor.ts` → `packages/dag-node/src/utils/node-descriptor.ts`

**Step 1: Move all files**

Use `git mv` for each file to preserve history. Create target directories first.

**Step 2: Update internal imports in moved files**

All moved files that import from dag-core internal paths (e.g., `../types/error.js`) must change to import from `@robota-sdk/dag-core` package.

Example — `abstract-node-definition.ts`:

Before:
```typescript
import type { ICostEstimate, IDagNodeDefinition, INodeExecutionContext, INodeTaskHandler } from '../types/node-lifecycle.js';
import type { TPortPayload } from '../interfaces/ports.js';
import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';
import { buildValidationError } from '../utils/error-builders.js';
```

After:
```typescript
import type { ICostEstimate, IDagNodeDefinition, INodeExecutionContext, INodeTaskHandler, TPortPayload, IDagError, TResult } from '@robota-sdk/dag-core';
import { buildValidationError } from '@robota-sdk/dag-core';
```

Cross-references between moved files stay as relative imports (e.g., `node-io-accessor.ts` imports from `./binary-value-parser.js` and `../value-objects/media-reference.js`).

**Step 3: Extract port definition helpers from domain.ts**

Create `packages/dag-node/src/port-definition-helpers.ts` with the following exports extracted from `packages/dag-core/src/types/domain.ts`:

- `IBinaryPortPreset`
- `IBinaryPortDefinitionInput`
- `BINARY_PORT_PRESETS`
- `createBinaryPortDefinition()`

These functions import `IPortDefinition`, `TBinaryKind`, `TPortValueType` from `@robota-sdk/dag-core`.

Remove these from `domain.ts` in dag-core.

**Step 4: Update dag-node barrel export**

Update `packages/dag-node/src/index.ts` to re-export all moved modules:

```typescript
// @robota-sdk/dag-node
// Node authoring infrastructure for the Robota DAG system.

export * from './lifecycle/abstract-node-definition.js';
export * from './lifecycle/node-io-accessor.js';
export * from './lifecycle/registered-node-lifecycle.js';
export * from './lifecycle/binary-value-parser.js';
export * from './lifecycle/static-node-lifecycle-factory.js';
export * from './lifecycle/default-node-task-handlers.js';
export * from './registry/static-node-manifest-registry.js';
export * from './value-objects/media-reference.js';
export * from './schemas/media-reference-schema.js';
export * from './utils/node-descriptor.js';
export * from './port-definition-helpers.js';
```

**Step 5: Build dag-node**

Run: `pnpm --filter @robota-sdk/dag-node build`
Expected: Build success.

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor(dag-node): move node infrastructure source files from dag-core"
```

---

### Task 3: Update dag-core re-exports and fix remaining imports

**Files:**
- Modify: `packages/dag-core/src/index.ts`
- Modify: `packages/dag-core/src/types/domain.ts` (remove extracted helpers)
- Modify: `packages/dag-core/src/services/node-lifecycle-runner.ts` (if it imports moved modules)
- Modify: `packages/dag-core/src/services/lifecycle-task-executor-port.ts` (if it imports moved modules)
- Modify: `packages/dag-core/package.json` (add dag-node dependency for re-exports)

**Step 1: Add dag-node dependency to dag-core**

Add to `packages/dag-core/package.json` dependencies:
```json
"@robota-sdk/dag-node": "workspace:*"
```

**Step 2: Update dag-core index.ts**

Replace the moved module exports with re-exports from dag-node:

```typescript
// Backward compat — owner is @robota-sdk/dag-node
export * from '@robota-sdk/dag-node';
```

Remove the old lines:
```
export * from './lifecycle/default-node-task-handlers.js';
export * from './lifecycle/abstract-node-definition.js';
export * from './lifecycle/binary-value-parser.js';
export * from './lifecycle/node-io-accessor.js';
export * from './lifecycle/registered-node-lifecycle.js';
export * from './lifecycle/static-node-lifecycle-factory.js';
export * from './registry/static-node-manifest-registry.js';
export * from './utils/node-descriptor.js';
export * from './schemas/media-reference-schema.js';
export * from './value-objects/media-reference.js';
```

**Step 3: Fix dag-core internal consumers**

`node-lifecycle-runner.ts` and `lifecycle-task-executor-port.ts` may import from moved modules. Update their imports to use `@robota-sdk/dag-node` or the re-exported surface from the same package.

**Step 4: Run pnpm install and build**

Run: `pnpm install && pnpm --filter @robota-sdk/dag-core build`
Expected: Build success.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(dag-core): re-export moved symbols from dag-node for backward compat"
```

---

### Task 4: Move test files to dag-node

**Files:**
- Move: `packages/dag-core/src/__tests__/abstract-node-definition.test.ts` → `packages/dag-node/src/__tests__/abstract-node-definition.test.ts`
- Move: `packages/dag-core/src/__tests__/node-io-accessor.test.ts` → `packages/dag-node/src/__tests__/node-io-accessor.test.ts`
- Move: `packages/dag-core/src/__tests__/registered-node-lifecycle.test.ts` → `packages/dag-node/src/__tests__/registered-node-lifecycle.test.ts`
- Move: `packages/dag-core/src/__tests__/binary-value-parser.test.ts` → `packages/dag-node/src/__tests__/binary-value-parser.test.ts`
- Move: `packages/dag-core/src/__tests__/static-node-lifecycle-factory.test.ts` → `packages/dag-node/src/__tests__/static-node-lifecycle-factory.test.ts`
- Move: `packages/dag-core/src/__tests__/static-node-manifest-registry.test.ts` → `packages/dag-node/src/__tests__/static-node-manifest-registry.test.ts`
- Move: `packages/dag-core/src/__tests__/media-reference.test.ts` → `packages/dag-node/src/__tests__/media-reference.test.ts`
- Move: `packages/dag-core/src/__tests__/media-reference-schema.test.ts` → `packages/dag-node/src/__tests__/media-reference-schema.test.ts`
- Move: `packages/dag-core/src/__tests__/node-descriptor.test.ts` → `packages/dag-node/src/__tests__/node-descriptor.test.ts`

**Step 1: Move test files**

Use `git mv` for each.

**Step 2: Update test imports**

Test files import from the module under test via relative paths. Update to import from the new relative paths (should be same since directory structure is preserved).

Tests that import types from dag-core (e.g., `IDagError`, `TResult`) keep those imports from `@robota-sdk/dag-core`.

**Step 3: Run all tests**

Run: `pnpm --filter @robota-sdk/dag-node test`
Expected: 122 tests pass.

Run: `pnpm --filter @robota-sdk/dag-core test`
Expected: Remaining dag-core tests pass (moved tests no longer run here).

**Step 4: Commit**

```bash
git add -A
git commit -m "test(dag-node): move node infrastructure tests from dag-core"
```

---

### Task 5: Update dag-nodes/* imports

**Files:**
- Modify: All 10 `packages/dag-nodes/*/package.json` — add `@robota-sdk/dag-node` dependency
- Modify: All 10 `packages/dag-nodes/*/src/index.ts` — update imports

**Step 1: Add dag-node dependency to each dag-nodes package**

For each of the 10 packages (`image-loader`, `image-source`, `input`, `text-output`, `text-template`, `transform`, `llm-text-openai`, `ok-emitter`, `gemini-image-edit`, `seedance-video`):

Add to `package.json` dependencies:
```json
"@robota-sdk/dag-node": "workspace:*"
```

**Step 2: Update imports in each node's source files**

Node implementations import symbols like `AbstractNodeDefinition`, `createBinaryPortDefinition`, `BINARY_PORT_PRESETS`, `MediaReference`, `createMediaReferenceConfigSchema` — change these from `@robota-sdk/dag-core` to `@robota-sdk/dag-node`.

Keep imports of core types (`IDagError`, `TResult`, `TPortPayload`, `ICostEstimate`, etc.) from `@robota-sdk/dag-core`.

Example — `packages/dag-nodes/input/src/index.ts`:

Before:
```typescript
import { AbstractNodeDefinition, type IDagNodeDefinition, type ICostEstimate, type IDagError, type INodeExecutionContext, type TResult, type TPortPayload } from '@robota-sdk/dag-core';
```

After:
```typescript
import { AbstractNodeDefinition } from '@robota-sdk/dag-node';
import type { IDagNodeDefinition, ICostEstimate, IDagError, INodeExecutionContext, TResult, TPortPayload } from '@robota-sdk/dag-core';
```

**Step 3: Run pnpm install and build all**

Run: `pnpm install && pnpm --filter "./packages/dag-nodes/**" build`
Expected: All 10 packages build successfully.

**Step 4: Run all dag-nodes tests**

Run: `pnpm --filter "./packages/dag-nodes/**" test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(dag-nodes): import node infrastructure from @robota-sdk/dag-node"
```

---

### Task 6: Write dag-node SPEC.md

**Files:**
- Create: `packages/dag-node/docs/SPEC.md`
- Modify: `packages/dag-core/docs/SPEC.md` — remove node infrastructure sections, add cross-reference
- Modify: `packages/dag-nodes/docs/SPEC.md` — update dependency references

**Step 1: Write packages/dag-node/docs/SPEC.md**

SSOT for node authoring infrastructure contracts:
- Package purpose and scope
- `AbstractNodeDefinition<TSchema>` contract (lifecycle hooks, config parsing)
- `NodeIoAccessor` API (typed input reading, output building)
- `RegisteredNodeLifecycle` (handler wrapping, port validation)
- Registry implementations (`StaticNodeManifestRegistry`, `StaticNodeTaskHandlerRegistry`)
- `MediaReference` value object and `MediaReferenceSchema`
- Port definition helpers (`createBinaryPortDefinition`, `BINARY_PORT_PRESETS`)
- `buildConfigSchema()` utility
- Type ownership table
- Class contract registry

**Step 2: Update dag-core SPEC.md**

Remove sections about `AbstractNodeDefinition`, `NodeIoAccessor`, registries, media reference from the dag-core SPEC. Add a cross-reference line: "Node authoring infrastructure → `@robota-sdk/dag-node` SPEC."

**Step 3: Update dag-nodes SPEC.md**

Update the dependency reference to mention both `@robota-sdk/dag-core` and `@robota-sdk/dag-node`.

**Step 4: Commit**

```bash
git add -A
git commit -m "docs(dag-node): add SPEC.md, update dag-core and dag-nodes SPEC cross-references"
```

---

### Task 7: Update project structure and full verification

**Files:**
- Modify: `.agents/project-structure.md` — add dag-node package entry
- Modify: `packages/dag-node/docs/SPEC.md` — finalize contract registry if needed

**Step 1: Update .agents/project-structure.md**

Add `dag-node` entry with dependency direction: `dag-core → dag-node → dag-nodes/*`.

**Step 2: Full verification**

Run: `pnpm install && pnpm build && pnpm typecheck && pnpm test`
Expected: All green. Zero regressions.

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: add dag-node to project structure, full verification pass"
```
