# Cost Estimation System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Orchestrator 레벨에서 CEL 수식 기반 크레딧 비용 추정 시스템을 구현한다.

**Architecture:** Orchestrator가 노드 타입별 CEL 수식을 스토리지(파일 → MongoDB)에서 로드하여 실행 전 크레딧을 추정. ComfyUI 레이어는 수정하지 않음. 수식 관리는 dag-designer UI + orchestrator API로 제공.

**Tech Stack:** CEL (`@marcbachmann/cel-js`), TypeScript, Vitest, Express, Next.js 15, React 19, Tailwind 4

**Design Doc:** `docs/plans/2026-03-14-cost-estimation-design.md`

**Research:** `.design/dag-benchmark/09-cost-estimation-research.md`, `10-expression-engine-research.md`, `11-cel-vs-jexl-comparison.md`

---

## Phase 1: Credits 마이그레이션 (Usd → Credits)

### Task 1: dag-core 타입 rename

**Files:**
- Modify: `packages/dag-core/src/types/node-lifecycle.ts:7-30`
- Modify: `packages/dag-core/src/types/run-result.ts:4-26`
- Modify: `packages/dag-core/src/types/domain.ts:96-100, 183-197`
- Modify: `packages/dag-core/src/interfaces/ports.ts:104-105, 122, 129-130`

**Step 1: Rename fields in node-lifecycle.ts**

```typescript
// ICostEstimate
estimatedCostUsd → estimatedCredits

// INodeExecutionContext
runCostLimitUsd → runCreditLimit
currentTotalCostUsd → currentTotalCredits

// INodeExecutionResult
estimatedCostUsd → estimatedCredits
totalCostUsd → totalCredits
```

**Step 2: Rename fields in run-result.ts**

```typescript
// IRunNodeTrace
estimatedCostUsd → estimatedCredits
totalCostUsd → totalCredits

// IRunResult
totalCostUsd → totalCredits
```

**Step 3: Rename fields in domain.ts**

```typescript
// ICostPolicy
runCostLimitUsd → runCreditLimit
costCurrency: 'USD' → 삭제 (크레딧은 화폐가 아님)

// ITaskRun
estimatedCostUsd → estimatedCredits
totalCostUsd → totalCredits
```

**Step 4: Rename fields in ports.ts (IStoragePort)**

```typescript
estimatedCostUsd → estimatedCredits
totalCostUsd → totalCredits
```

**Step 5: Run typecheck to find all broken references**

Run: `pnpm --filter @robota-sdk/dag-core typecheck`
Expected: Multiple type errors showing all consumers that need updating

**Step 6: Commit**

```bash
git add packages/dag-core/
git commit -m "refactor(dag-core): rename CostUsd fields to Credits"
```

---

### Task 2: dag-core 서비스 rename

**Files:**
- Modify: `packages/dag-core/src/services/node-lifecycle-runner.ts` (15+ references)
- Modify: `packages/dag-core/src/services/lifecycle-task-executor-port.ts:65, 76-77`
- Test: `packages/dag-core/src/__tests__/node-lifecycle-runner.test.ts`

**Step 1: Update RunCostPolicyEvaluator**

`node-lifecycle-runner.ts`의 `assertWithinBudget` 파라미터 및 내부 변수명 rename:
```typescript
currentTotalCostUsd → currentTotalCredits
nextEstimatedCostUsd → nextEstimatedCredits
runCostLimitUsd → runCreditLimit
nextTotalCostUsd → nextTotalCredits
```

에러 코드도 변경:
```typescript
'DAG_VALIDATION_NEGATIVE_ESTIMATED_COST' → 'DAG_VALIDATION_NEGATIVE_ESTIMATED_CREDITS'
'DAG_VALIDATION_COST_LIMIT_EXCEEDED' → 'DAG_VALIDATION_CREDIT_LIMIT_EXCEEDED'
```

**Step 2: Update lifecycle-task-executor-port.ts**

동일하게 rename.

**Step 3: Update tests**

`node-lifecycle-runner.test.ts`의 모든 `CostUsd` 참조를 `Credits`로 변경.

**Step 4: Run tests**

Run: `pnpm --filter @robota-sdk/dag-core test`
Expected: All pass

**Step 5: Commit**

```bash
git add packages/dag-core/
git commit -m "refactor(dag-core): rename CostUsd in services and tests to Credits"
```

---

### Task 3: dag-orchestrator 타입 및 서비스 rename

**Files:**
- Modify: `packages/dag-orchestrator/src/types/orchestrator-types.ts:3-10`
- Modify: `packages/dag-orchestrator/src/interfaces/orchestrator-policy-port.ts:4-16`
- Modify: `packages/dag-orchestrator/src/services/prompt-orchestrator-service.ts`
- Modify: `packages/dag-orchestrator/src/services/orchestrator-run-service.ts`
- Modify: `packages/dag-orchestrator/src/index.ts`
- Test: `packages/dag-orchestrator/src/__tests__/prompt-orchestrator-service.test.ts`

**Step 1: Rename orchestrator-types.ts**

```typescript
// Before
export interface ICostEstimate {
    totalEstimatedCostUsd: number;
    perNode: Record<string, { nodeType: string; estimatedCostUsd: number }>;
}
export interface ICostPolicy {
    maxCostPerPromptUsd: number;
}

// After
export interface ICostEstimate {
    totalEstimatedCredits: number;
    perNode: Record<string, { nodeType: string; estimatedCredits: number }>;
}
export interface ICostPolicy {
    maxCreditsPerPrompt: number;
}
```

**Step 2: Update service and tests**

**Step 3: Run tests**

Run: `pnpm --filter @robota-sdk/dag-orchestrator test`
Expected: All pass

**Step 4: Commit**

```bash
git add packages/dag-orchestrator/
git commit -m "refactor(dag-orchestrator): rename CostUsd to Credits"
```

---

### Task 4: dag-nodes, dag-worker, dag-designer, apps rename

**Files:**
- Modify: `packages/dag-nodes/*/src/index.ts` (all node implementations)
- Modify: `packages/dag-worker/src/services/worker-loop-service.ts`
- Modify: `packages/dag-designer/src/client/designer-api-client.ts`
- Modify: `apps/dag-orchestrator-server/src/server.ts:83-93`
- Modify: `apps/web/src/app/dag-designer/_components/dag-designer-screen.tsx:351`
- Test: All related test files

**Step 1: Rename all dag-nodes (bulk)**

모든 노드의 `estimatedCostUsd` → `estimatedCredits` rename.

**Step 2: Rename dag-worker**

`resolveCurrentTotalCostUsd` → `resolveCurrentTotalCredits` 및 관련 필드.

**Step 3: Rename dag-designer and web app**

**Step 4: Rename orchestrator server stubs**

```typescript
const stubCostEstimator: ICostEstimatorPort = {
    async estimateCost() {
        return { ok: true, value: { totalEstimatedCredits: 0, perNode: {} } };
    }
};
```

**Step 5: Run full build and tests**

Run: `pnpm build && pnpm test`
Expected: All pass

**Step 6: Commit**

```bash
git add .
git commit -m "refactor: complete CostUsd to Credits migration across monorepo"
```

---

### Task 5: DAG preset JSON 파일 업데이트

**Files:**
- Modify: `apps/web/src/app/dag-designer/presets/*.json` (all presets)

**Step 1: Update costPolicy fields in presets**

```json
// Before
"costPolicy": { "runCostLimitUsd": 10, "costCurrency": "USD", "costPolicyVersion": 1 }

// After
"costPolicy": { "runCreditLimit": 100, "costPolicyVersion": 2 }
```

**Step 2: Run build**

Run: `pnpm build`
Expected: Pass

**Step 3: Commit**

```bash
git add apps/web/src/app/dag-designer/presets/
git commit -m "refactor: update preset costPolicy to Credits"
```

---

## Phase 2: CEL 수식 엔진 + 스토리지

### Task 6: CEL 의존성 추가 및 수식 평가 서비스

**Files:**
- Modify: `packages/dag-orchestrator/package.json` (add `@marcbachmann/cel-js`)
- Create: `packages/dag-orchestrator/src/services/cel-cost-evaluator.ts`
- Test: `packages/dag-orchestrator/src/__tests__/cel-cost-evaluator.test.ts`

**Step 1: Install dependency**

Run: `pnpm --filter @robota-sdk/dag-orchestrator add @marcbachmann/cel-js`

**Step 2: Write failing tests**

```typescript
// cel-cost-evaluator.test.ts
import { describe, it, expect } from 'vitest';
import { CelCostEvaluator } from '../services/cel-cost-evaluator.js';

describe('CelCostEvaluator', () => {
    const evaluator = new CelCostEvaluator();

    it('evaluates fixed cost formula', () => {
        const result = evaluator.evaluate('0', {});
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe(0);
    });

    it('evaluates formula with input context', () => {
        const result = evaluator.evaluate(
            'len(input.prompt) / 4.0 * rate',
            { input: { prompt: 'hello world' }, rate: 0.001 }
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBeCloseTo(0.00275, 4);
    });

    it('evaluates formula with config and variables', () => {
        const result = evaluator.evaluate(
            'baseCost + (size(input.images) > 0 ? surcharge : 0.0)',
            { input: { images: ['img.png'] }, baseCost: 8.0, surcharge: 2.0 }
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe(10.0);
    });

    it('evaluates lookup table formula', () => {
        const result = evaluator.evaluate(
            'double(tokens) * rates[model]',
            { tokens: 1000, model: 'gpt-4o-mini', rates: { 'gpt-4o-mini': 0.15 } }
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe(150.0);
    });

    it('returns error for invalid formula', () => {
        const result = evaluator.evaluate('invalid +++', {});
        expect(result.ok).toBe(false);
    });

    it('validates formula without evaluating', () => {
        expect(evaluator.validate('1 + 2').ok).toBe(true);
        expect(evaluator.validate('invalid +++').ok).toBe(false);
    });
});
```

**Step 3: Run tests to verify they fail**

Run: `pnpm --filter @robota-sdk/dag-orchestrator test -- cel-cost-evaluator`
Expected: FAIL (module not found)

**Step 4: Implement CelCostEvaluator**

```typescript
// cel-cost-evaluator.ts
import { evaluate } from '@marcbachmann/cel-js';
import type { TResult } from '@robota-sdk/dag-core';
import type { IDagError } from '@robota-sdk/dag-core';

export class CelCostEvaluator {
    evaluate(
        formula: string,
        context: Record<string, unknown>,
    ): TResult<number, IDagError> {
        try {
            const result = evaluate(formula, context);
            if (typeof result !== 'number') {
                return {
                    ok: false,
                    error: {
                        code: 'COST_EVALUATION_TYPE_ERROR',
                        message: `Formula must return a number, got ${typeof result}`,
                    },
                };
            }
            return { ok: true, value: result };
        } catch (err) {
            return {
                ok: false,
                error: {
                    code: 'COST_EVALUATION_FAILED',
                    message: err instanceof Error ? err.message : String(err),
                },
            };
        }
    }

    validate(formula: string): TResult<void, IDagError> {
        try {
            // CEL parse-only check — evaluate with empty context to verify syntax
            evaluate(formula, {});
            return { ok: true, value: undefined };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // Distinguish syntax errors from missing variable errors
            if (message.includes('undeclared') || message.includes('no such key')) {
                return { ok: true, value: undefined }; // Formula is syntactically valid
            }
            return {
                ok: false,
                error: { code: 'COST_FORMULA_INVALID', message },
            };
        }
    }
}
```

Note: `validate`의 정확한 구현은 `@marcbachmann/cel-js`의 실제 에러 메시지를 확인한 후 조정 필요. 라이브러리가 `Environment.check()` API를 지원하면 그것을 사용.

**Step 5: Run tests**

Run: `pnpm --filter @robota-sdk/dag-orchestrator test -- cel-cost-evaluator`
Expected: All pass

**Step 6: Commit**

```bash
git add packages/dag-orchestrator/
git commit -m "feat(dag-orchestrator): add CelCostEvaluator with CEL formula engine"
```

---

### Task 7: ICostMeta 타입 + ICostMetaStoragePort 인터페이스

**Files:**
- Create: `packages/dag-orchestrator/src/types/cost-meta-types.ts`
- Modify: `packages/dag-orchestrator/src/interfaces/` (add new port file)
- Create: `packages/dag-orchestrator/src/interfaces/cost-meta-storage-port.ts`
- Modify: `packages/dag-orchestrator/src/index.ts` (export new types)

**Step 1: Create cost-meta-types.ts**

```typescript
export type TCostMetaCategory = 'ai-inference' | 'transform' | 'io' | 'custom';

export interface ICostMeta {
    nodeType: string;
    displayName: string;
    category: TCostMetaCategory;
    estimateFormula: string;
    calculateFormula?: string;
    variables: Record<string, unknown>;
    enabled: boolean;
    updatedAt: string;
}
```

**Step 2: Create cost-meta-storage-port.ts**

```typescript
import type { ICostMeta } from '../types/cost-meta-types.js';

export interface ICostMetaStoragePort {
    get(nodeType: string): Promise<ICostMeta | undefined>;
    getAll(): Promise<ICostMeta[]>;
    save(meta: ICostMeta): Promise<void>;
    delete(nodeType: string): Promise<void>;
}
```

**Step 3: Export from index.ts**

**Step 4: Run typecheck**

Run: `pnpm --filter @robota-sdk/dag-orchestrator typecheck`
Expected: Pass

**Step 5: Commit**

```bash
git add packages/dag-orchestrator/
git commit -m "feat(dag-orchestrator): add ICostMeta types and ICostMetaStoragePort"
```

---

### Task 8: 파일 기반 스토리지 어댑터

**Files:**
- Create: `packages/dag-orchestrator/src/adapters/file-cost-meta-storage.ts`
- Test: `packages/dag-orchestrator/src/__tests__/file-cost-meta-storage.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { FileCostMetaStorage } from '../adapters/file-cost-meta-storage.js';
import type { ICostMeta } from '../types/cost-meta-types.js';

const TEST_DIR = '/tmp/robota-cost-meta-test';

describe('FileCostMetaStorage', () => {
    let storage: FileCostMetaStorage;

    const sampleMeta: ICostMeta = {
        nodeType: 'test-node',
        displayName: 'Test Node',
        category: 'ai-inference',
        estimateFormula: '10.0',
        variables: {},
        enabled: true,
        updatedAt: '2026-03-15T00:00:00Z',
    };

    beforeEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
        mkdirSync(TEST_DIR, { recursive: true });
        storage = new FileCostMetaStorage(TEST_DIR);
    });

    afterEach(() => {
        if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    });

    it('returns undefined for unknown nodeType', async () => {
        expect(await storage.get('unknown')).toBeUndefined();
    });

    it('saves and retrieves cost meta', async () => {
        await storage.save(sampleMeta);
        const result = await storage.get('test-node');
        expect(result).toEqual(sampleMeta);
    });

    it('lists all cost metas', async () => {
        await storage.save(sampleMeta);
        await storage.save({ ...sampleMeta, nodeType: 'test-node-2', displayName: 'Test 2' });
        const all = await storage.getAll();
        expect(all).toHaveLength(2);
    });

    it('deletes cost meta', async () => {
        await storage.save(sampleMeta);
        await storage.delete('test-node');
        expect(await storage.get('test-node')).toBeUndefined();
    });

    it('persists across instances', async () => {
        await storage.save(sampleMeta);
        const storage2 = new FileCostMetaStorage(TEST_DIR);
        expect(await storage2.get('test-node')).toEqual(sampleMeta);
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @robota-sdk/dag-orchestrator test -- file-cost-meta-storage`
Expected: FAIL

**Step 3: Implement FileCostMetaStorage**

```typescript
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ICostMetaStoragePort } from '../interfaces/cost-meta-storage-port.js';
import type { ICostMeta } from '../types/cost-meta-types.js';

export class FileCostMetaStorage implements ICostMetaStoragePort {
    private readonly filePath: string;
    private cache: Map<string, ICostMeta>;

    constructor(dataDir: string) {
        this.filePath = join(dataDir, 'cost-meta.json');
        this.cache = this.loadFromFile();
    }

    async get(nodeType: string): Promise<ICostMeta | undefined> {
        return this.cache.get(nodeType);
    }

    async getAll(): Promise<ICostMeta[]> {
        return Array.from(this.cache.values());
    }

    async save(meta: ICostMeta): Promise<void> {
        this.cache.set(meta.nodeType, meta);
        this.writeToFile();
    }

    async delete(nodeType: string): Promise<void> {
        this.cache.delete(nodeType);
        this.writeToFile();
    }

    private loadFromFile(): Map<string, ICostMeta> {
        if (!existsSync(this.filePath)) return new Map();
        const data = JSON.parse(readFileSync(this.filePath, 'utf-8')) as ICostMeta[];
        return new Map(data.map((m) => [m.nodeType, m]));
    }

    private writeToFile(): void {
        const data = Array.from(this.cache.values());
        writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    }
}
```

**Step 4: Run tests**

Run: `pnpm --filter @robota-sdk/dag-orchestrator test -- file-cost-meta-storage`
Expected: All pass

**Step 5: Commit**

```bash
git add packages/dag-orchestrator/
git commit -m "feat(dag-orchestrator): add FileCostMetaStorage adapter"
```

---

### Task 9: CEL 기반 ICostEstimatorPort 구현

**Files:**
- Modify: `packages/dag-orchestrator/src/interfaces/orchestrator-policy-port.ts` (expand signature)
- Create: `packages/dag-orchestrator/src/adapters/cel-cost-estimator-adapter.ts`
- Test: `packages/dag-orchestrator/src/__tests__/cel-cost-estimator-adapter.test.ts`

**Step 1: Expand ICostEstimatorPort signature**

```typescript
// Before
estimateCost(nodeTypes: string[], objectInfo: TObjectInfo): Promise<TResult<ICostEstimate, IDagError>>;

// After
estimateCost(prompt: TPrompt, objectInfo: TObjectInfo): Promise<TResult<ICostEstimate, IDagError>>;
```

**Step 2: Write failing tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { CelCostEstimatorAdapter } from '../adapters/cel-cost-estimator-adapter.js';
import type { ICostMetaStoragePort } from '../interfaces/cost-meta-storage-port.js';
import type { ICostMeta } from '../types/cost-meta-types.js';
import type { TPrompt, TObjectInfo } from '@robota-sdk/dag-core';

describe('CelCostEstimatorAdapter', () => {
    let storage: ICostMetaStoragePort;
    let adapter: CelCostEstimatorAdapter;

    const mockStorage: ICostMetaStoragePort = {
        async get(nodeType) {
            const metas: Record<string, ICostMeta> = {
                'llm-node': {
                    nodeType: 'llm-node',
                    displayName: 'LLM',
                    category: 'ai-inference',
                    estimateFormula: 'double(len(input.prompt)) / 4.0 * rate',
                    variables: { rate: 0.1 },
                    enabled: true,
                    updatedAt: '',
                },
                'free-node': {
                    nodeType: 'free-node',
                    displayName: 'Free',
                    category: 'io',
                    estimateFormula: '0',
                    variables: {},
                    enabled: true,
                    updatedAt: '',
                },
            };
            return metas[nodeType];
        },
        async getAll() { return []; },
        async save() {},
        async delete() {},
    };

    beforeEach(() => {
        adapter = new CelCostEstimatorAdapter(mockStorage);
    });

    it('estimates cost for nodes with formulas', async () => {
        const prompt: TPrompt = {
            node1: { class_type: 'llm-node', inputs: { prompt: 'hello world test' } },
        };
        const result = await adapter.estimateCost(prompt, {} as TObjectInfo);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.totalEstimatedCredits).toBeGreaterThan(0);
            expect(result.value.perNode['node1']).toBeDefined();
        }
    });

    it('returns 0 for nodes without cost meta', async () => {
        const prompt: TPrompt = {
            node1: { class_type: 'unknown-node', inputs: {} },
        };
        const result = await adapter.estimateCost(prompt, {} as TObjectInfo);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.totalEstimatedCredits).toBe(0);
        }
    });

    it('sums credits across multiple nodes', async () => {
        const prompt: TPrompt = {
            node1: { class_type: 'llm-node', inputs: { prompt: 'test' } },
            node2: { class_type: 'free-node', inputs: {} },
        };
        const result = await adapter.estimateCost(prompt, {} as TObjectInfo);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.perNode['node2'].estimatedCredits).toBe(0);
        }
    });
});
```

**Step 3: Run tests to verify they fail**

**Step 4: Implement CelCostEstimatorAdapter**

```typescript
import type { TPrompt, TObjectInfo, TResult, IDagError } from '@robota-sdk/dag-core';
import type { ICostEstimatorPort } from '../interfaces/orchestrator-policy-port.js';
import type { ICostEstimate } from '../types/orchestrator-types.js';
import type { ICostMetaStoragePort } from '../interfaces/cost-meta-storage-port.js';
import { CelCostEvaluator } from '../services/cel-cost-evaluator.js';

export class CelCostEstimatorAdapter implements ICostEstimatorPort {
    private readonly evaluator = new CelCostEvaluator();

    constructor(private readonly storage: ICostMetaStoragePort) {}

    async estimateCost(
        prompt: TPrompt,
        _objectInfo: TObjectInfo,
    ): Promise<TResult<ICostEstimate, IDagError>> {
        let totalEstimatedCredits = 0;
        const perNode: ICostEstimate['perNode'] = {};

        for (const [nodeId, nodeDef] of Object.entries(prompt)) {
            const costMeta = await this.storage.get(nodeDef.class_type);

            if (!costMeta || !costMeta.enabled) {
                perNode[nodeId] = { nodeType: nodeDef.class_type, estimatedCredits: 0 };
                continue;
            }

            const context = {
                input: nodeDef.inputs,
                config: nodeDef.inputs,  // ComfyUI prompt에서는 inputs에 config가 포함됨
                ...costMeta.variables,
            };

            const evalResult = this.evaluator.evaluate(costMeta.estimateFormula, context);
            if (!evalResult.ok) return evalResult as TResult<never, IDagError>;

            perNode[nodeId] = { nodeType: nodeDef.class_type, estimatedCredits: evalResult.value };
            totalEstimatedCredits += evalResult.value;
        }

        return { ok: true, value: { totalEstimatedCredits, perNode } };
    }
}
```

**Step 5: Update PromptOrchestratorService to pass TPrompt**

`prompt-orchestrator-service.ts` 변경:
```typescript
// Before (line 40-44)
const nodeTypes = Object.values(promptRequest.prompt).map((n) => n.class_type);
const estimateResult = await this.costEstimator.estimateCost(nodeTypes, objectInfoResult.value);

// After
const estimateResult = await this.costEstimator.estimateCost(promptRequest.prompt, objectInfoResult.value);
```

**Step 6: Update existing tests**

`prompt-orchestrator-service.test.ts`의 mock을 새 시그니처에 맞게 변경.

**Step 7: Run tests**

Run: `pnpm --filter @robota-sdk/dag-orchestrator test`
Expected: All pass

**Step 8: Commit**

```bash
git add packages/dag-orchestrator/
git commit -m "feat(dag-orchestrator): implement CelCostEstimatorAdapter with TPrompt signature"
```

---

## Phase 3: Orchestrator API

### Task 10: 비용 메타 CRUD 라우트

**Files:**
- Create: `apps/dag-orchestrator-server/src/routes/cost-meta-routes.ts`
- Modify: `apps/dag-orchestrator-server/src/server.ts` (register routes, replace stub)
- Test: `apps/dag-orchestrator-server/src/__tests__/cost-meta-routes.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
// Express supertest 또는 직접 fetch로 API 테스트
// GET /v1/cost-meta → 200, []
// POST /v1/cost-meta → 201, saved
// GET /v1/cost-meta/:nodeType → 200, meta
// PUT /v1/cost-meta/:nodeType → 200, updated
// DELETE /v1/cost-meta/:nodeType → 204
// POST /v1/cost-meta/validate → 200, { ok: true/false }
// POST /v1/cost-meta/preview → 200, { ok: true, result: number }
```

**Step 2: Implement cost-meta-routes.ts**

7개 엔드포인트:
- `GET /v1/cost-meta` — `storage.getAll()`
- `GET /v1/cost-meta/:nodeType` — `storage.get(nodeType)`
- `POST /v1/cost-meta` — CEL `validate()` → `storage.save()`
- `PUT /v1/cost-meta/:nodeType` — CEL `validate()` → `storage.save()`
- `DELETE /v1/cost-meta/:nodeType` — `storage.delete()`
- `POST /v1/cost-meta/validate` — CEL `validate()` only
- `POST /v1/cost-meta/preview` — CEL `evaluate()` with testContext

**Step 3: Wire up in server.ts**

- `FileCostMetaStorage` 생성 (`dataDir` 설정)
- `CelCostEstimatorAdapter` 생성 (storage 주입)
- `PromptOrchestratorService`에 real adapter 주입 (stub 교체)
- cost-meta-routes 등록

**Step 4: Run tests**

Run: `pnpm --filter dag-orchestrator-server test`
Expected: All pass

**Step 5: Commit**

```bash
git add apps/dag-orchestrator-server/
git commit -m "feat(dag-orchestrator-server): add cost-meta CRUD and validate/preview API"
```

---

## Phase 4: dag-designer UI

### Task 11: 비용 관리 목록 화면

**Files:**
- Create: `apps/web/src/app/dag-designer/cost-management/page.tsx`
- Modify: `apps/web/src/app/dag-designer/page.tsx` (진입점 버튼 추가)

**Step 1: API 클라이언트 함수 작성**

orchestrator `/v1/cost-meta` API 호출 함수.

**Step 2: 목록 페이지 구현**

- `/object_info`에서 전체 노드 목록 fetch
- `/v1/cost-meta`에서 등록된 수식 fetch
- 합쳐서 "활성/미등록" 상태 표시
- "새 노드 등록" 버튼 → 편집 화면으로 이동

**Step 3: dag-designer 메인 페이지에 진입점 추가**

"비용 관리" 버튼 또는 네비게이션 링크.

**Step 4: Commit**

```bash
git add apps/web/
git commit -m "feat(web): add cost management list page in dag-designer"
```

---

### Task 12: 비용 메타 편집 화면

**Files:**
- Create: `apps/web/src/app/dag-designer/cost-management/[nodeType]/page.tsx`

**Step 1: 편집 폼 구현**

- 카테고리 선택 (ai-inference, transform, io, custom)
- 수식 입력 영역 (코드 에디터 스타일)
- 변수(variables) JSON 편집 영역
- 실시간 검증 (`/v1/cost-meta/validate` 호출)
- 저장 (`POST` 또는 `PUT /v1/cost-meta`)

**Step 2: 테스트 패널 구현**

- 테스트 input/config 입력 필드
- "미리보기" 버튼 → `/v1/cost-meta/preview` 호출
- 예상 크레딧 결과 표시

**Step 3: Commit**

```bash
git add apps/web/
git commit -m "feat(web): add cost meta edit page with formula editor and preview"
```

---

### Task 13: DAG 실행 전 비용 표시

**Files:**
- Modify: `apps/web/src/app/dag-designer/_components/dag-designer-screen.tsx`

**Step 1: 실행 확인 다이얼로그에 비용 추정 추가**

DAG 실행 버튼 클릭 시:
1. orchestrator에 비용 추정 요청 (새 API 필요하거나 submitPrompt 응답의 costEstimate 활용)
2. 노드별 예상 크레딧 표시
3. 합계 표시
4. 확인 후 실행

**Step 2: Commit**

```bash
git add apps/web/
git commit -m "feat(web): show estimated credits before DAG execution"
```

---

## Phase 5: 통합 검증

### Task 14: E2E 흐름 검증

**Step 1: orchestrator-server 시작**

Run: `pnpm --filter dag-orchestrator-server dev`

**Step 2: 비용 메타 등록 (API 직접 호출)**

```bash
curl -X POST http://localhost:3012/v1/cost-meta \
  -H 'Content-Type: application/json' \
  -d '{"nodeType":"llm-text-openai","displayName":"LLM Text","category":"ai-inference","estimateFormula":"len(input.prompt) / 4.0 * rate","variables":{"rate":0.1},"enabled":true,"updatedAt":"2026-03-15T00:00:00Z"}'
```

**Step 3: 수식 미리보기**

```bash
curl -X POST http://localhost:3012/v1/cost-meta/preview \
  -H 'Content-Type: application/json' \
  -d '{"formula":"len(input.prompt) / 4.0 * rate","variables":{"rate":0.1},"testContext":{"input":{"prompt":"hello world"}}}'
```

Expected: `{ "ok": true, "result": 0.275 }`

**Step 4: DAG 실행하여 비용 추정 확인**

**Step 5: Full build and test**

Run: `pnpm build && pnpm test`
Expected: All pass

**Step 6: Commit**

```bash
git commit -m "test: verify cost estimation E2E flow"
```

---

## Task Dependencies

```
Phase 1: Credits Migration
  Task 1 → Task 2 → Task 3 → Task 4 → Task 5

Phase 2: CEL Engine + Storage
  Task 6 (CEL evaluator, independent)
  Task 7 (types/ports, independent)
  Task 8 (file storage, depends on Task 7)
  Task 9 (adapter, depends on Task 3 + 6 + 7 + 8)

Phase 3: API
  Task 10 (depends on Task 8 + 9)

Phase 4: UI
  Task 11 (depends on Task 10)
  Task 12 (depends on Task 11)
  Task 13 (depends on Task 10)

Phase 5: Integration
  Task 14 (depends on all)
```

## Notes

- `@marcbachmann/cel-js`의 실제 API가 코드 예시와 다를 수 있음. Task 6에서 라이브러리 확인 후 조정.
- `validate()` 구현은 CEL 라이브러리의 실제 에러 타입에 따라 조정 필요.
- UI (Task 11-13)는 디자인 상세가 구현 중 결정될 수 있음. 와이어프레임 수준으로 시작.
- 파일 스토리지 경로(`dataDir`)는 orchestrator-server 환경 변수로 설정.
