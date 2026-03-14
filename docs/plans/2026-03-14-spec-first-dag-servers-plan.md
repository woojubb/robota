# Spec-First DAG Servers Refactoring Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create SPEC.md and contract tests for dag-runtime-server, dag-orchestrator, dag-orchestrator-server, and update dag-designer SPEC to enforce spec-first development across all DAG contract boundaries.

**Architecture:** Bottom-up spec creation following contract dependency direction: runtime → orchestrator pkg → orchestrator server → designer. Each phase: write SPEC.md, write contract tests, fix code to match spec.

**Tech Stack:** Markdown (SPEC.md), TypeScript, Vitest

---

## Phase 1: dag-runtime-server

### Task 1: Write dag-runtime-server SPEC.md

**Files:**
- Create: `apps/dag-runtime-server/docs/SPEC.md`
- Reference: `.design/dag-benchmark/03-comfyui.md`
- Reference: `apps/dag-runtime-server/src/routes/prompt-routes.ts`
- Reference: `apps/dag-runtime-server/src/routes/ws-routes.ts`
- Reference: `apps/dag-runtime-server/src/server.ts`

**Step 1: Read all source files and ComfyUI reference spec**

Read the following to understand the full API surface:
- `.design/dag-benchmark/03-comfyui.md` (ComfyUI reference)
- `apps/dag-runtime-server/src/routes/prompt-routes.ts` (HTTP endpoints)
- `apps/dag-runtime-server/src/routes/ws-routes.ts` (WS endpoint)
- `apps/dag-runtime-server/src/server.ts` (bootstrap, health endpoint)
- `apps/dag-runtime-server/src/adapters/dag-prompt-backend.ts` (prompt backend port)

**Step 2: Write SPEC.md with all 9 required sections**

Follow `@spec-writing-standard` skill. Required sections:
1. Scope — ComfyUI-compatible Prompt API execution server
2. Boundaries — does NOT own orchestration, DAG design, or cost policies
3. Architecture Overview — Express app, port adapters, node lifecycle runner
4. Type Ownership — no SSOT types (all from dag-core); list port implementations
5. Public API Surface — HTTP endpoints table (12 + health) with request/response shapes and implementation status (implemented/stub), WS endpoint
6. Extension Points — port implementations (IStoragePort, ITaskExecutorPort, IAssetStore, INodeCatalogService)
7. Error Taxonomy — ComfyUI-native error format (NOT IProblemDetails), list error shapes per endpoint
8. Test Strategy — current: 0 tests; planned: endpoint contract tests
9. Class Contract Registry — port implementations table

For the Public API Surface, use this format:

```markdown
| Endpoint | Method | Status | Request | Response |
|----------|--------|--------|---------|----------|
| `/prompt` | POST | implemented | IPromptRequest | IPromptResponse |
| `/queue` | GET | implemented | — | IQueueStatus |
| ...
```

Include WS events table:

```markdown
| ComfyUI Event | Direction | Payload |
|---------------|-----------|---------|
| `execution_start` | server→client | `{ type, data: { prompt_id } }` |
| ...
```

**Step 3: Verify SPEC.md matches code**

Cross-check every endpoint listed in SPEC.md against `prompt-routes.ts`.
Cross-check every WS event against `ws-routes.ts`.

**Step 4: Commit**

```bash
git add apps/dag-runtime-server/docs/SPEC.md
git commit -m "docs(dag-runtime-server): add SPEC.md with ComfyUI-compatible API contract"
```

---

### Task 2: Write dag-runtime-server endpoint contract tests

**Files:**
- Create: `apps/dag-runtime-server/src/__tests__/endpoint-contract.test.ts`
- Reference: `apps/dag-runtime-server/docs/SPEC.md` (just written)
- Reference: `apps/dag-runtime-server/src/routes/prompt-routes.ts`

**Step 1: Write contract tests for response shapes**

Test that each implemented endpoint returns the correct shape. Use supertest or direct route handler invocation. Key assertions:

- `POST /prompt` → response has `prompt_id` (string), `number` (number), `node_errors` (object)
- `GET /queue` → response has `queue_running` (array), `queue_pending` (array)
- `GET /history` → response is `Record<string, IHistoryEntry>`
- `GET /history/:prompt_id` → response is `Record<string, IHistoryEntry>` with exactly one key
- `GET /object_info` → response is `Record<string, INodeObjectInfo>`
- `GET /system_stats` → response has `system` object
- Stub endpoints (`POST /interrupt`, `POST /free`) → return valid ComfyUI shapes
- `GET /health` → `{ status: "ok" }`

Each test should verify:
1. HTTP status code
2. Response body shape (field names and types)
3. No IProblemDetails in error responses (ComfyUI format only)

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @robota-sdk/dag-runtime-server test`
Expected: FAIL (tests reference shapes that may not exactly match current code)

**Step 3: Fix any code discrepancies to match SPEC**

Adjust routes or test expectations so code matches the spec. Do not change the spec to match bad code.

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @robota-sdk/dag-runtime-server test`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/dag-runtime-server/src/__tests__/endpoint-contract.test.ts
git commit -m "test(dag-runtime-server): add endpoint contract tests for ComfyUI API"
```

---

## Phase 2: dag-orchestrator (package)

### Task 3: Write dag-orchestrator SPEC.md

**Files:**
- Create: `packages/dag-orchestrator/docs/SPEC.md`
- Reference: `packages/dag-orchestrator/src/services/orchestrator-run-service.ts`
- Reference: `packages/dag-orchestrator/src/adapters/definition-to-prompt-translator.ts`
- Reference: `packages/dag-orchestrator/src/interfaces/prompt-api-client-port.ts`
- Reference: `packages/dag-orchestrator/src/index.ts`

**Step 1: Read all source files**

Read every file in `packages/dag-orchestrator/src/` to understand:
- Service contracts (OrchestratorRunService, PromptOrchestratorService)
- Port interfaces (IPromptApiClientPort, ICostEstimatorPort, ICostPolicyEvaluatorPort)
- Adapters (HttpPromptApiClient, translateDefinitionToPrompt)

**Step 2: Write SPEC.md with all 9 required sections**

Key points for each section:
1. Scope — orchestration layer bridging DAG definitions to Prompt API execution
2. Boundaries — does NOT own runtime execution, does NOT own DAG storage, does NOT own UI
3. Architecture Overview — services (run management, orchestration), adapters (HTTP client, translator), ports
4. Type Ownership — owns orchestrator-specific types (IOrchestratorConfig, etc.); dag-core owns IRunResult
5. Public API Surface — exported classes and functions from index.ts
6. Extension Points — IPromptApiClientPort, ICostEstimatorPort, ICostPolicyEvaluatorPort
7. Error Taxonomy — ORCHESTRATOR_* error codes
8. Test Strategy — current tests + planned contract tests
9. Class Contract Registry — HttpPromptApiClient implements IPromptApiClientPort, etc.

**Critical spec items to include:**
- `translateDefinitionToPrompt` must handle object config values (not just primitives)
- dagRunId = promptId principle: orchestrator uses runtime's prompt_id as dagRunId
- `OrchestratorRunService.recordEvent()` accumulates events for failed-run error reporting

**Step 3: Verify against code**

Cross-check type names, exports, and class contracts against actual source.

**Step 4: Commit**

```bash
git add packages/dag-orchestrator/docs/SPEC.md
git commit -m "docs(dag-orchestrator): add SPEC.md with orchestration contracts"
```

---

### Task 4: Write dag-orchestrator contract tests for translator and run service

**Files:**
- Create: `packages/dag-orchestrator/src/__tests__/translator-contract.test.ts`
- Create: `packages/dag-orchestrator/src/__tests__/run-service-contract.test.ts`
- Reference: `packages/dag-orchestrator/docs/SPEC.md` (just written)

**Step 1: Write translator contract tests**

Test `translateDefinitionToPrompt`:
- Primitive config values (string, number, boolean) are copied to inputs
- **Object config values (e.g., nested asset references) are copied to inputs** — this is the bug fix
- Edge bindings produce TPromptLink arrays
- Empty definition returns error
- Input node receives TPortPayload values

**Step 2: Write run service contract tests**

Test `OrchestratorRunService`:
- `createRun` stores run state with `nodeEvents: []`
- `startRun` calls promptClient.submitPrompt and stores promptId
- `recordEvent` accumulates events; terminal events update status
- `getRunResult` for failed run returns `{ ok: true, value: { status: 'failed', nodeErrors: [...] } }`
- `getRunResult` for success returns `{ ok: true, value: { status: 'success', nodeErrors: [] } }`
- dagRunId returned from startRun equals promptId from runtime

**Step 3: Run tests to verify they fail**

Run: `pnpm --filter @robota-sdk/dag-orchestrator test`
Expected: FAIL (translator object config test fails because current code drops objects)

**Step 4: Fix translator to handle object config values**

In `packages/dag-orchestrator/src/adapters/definition-to-prompt-translator.ts`, change the config loop to also handle objects:

```typescript
for (const [key, value] of Object.entries(node.config)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        inputs[key] = value;
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        inputs[key] = value as TPromptInputValue;
    }
}
```

Also update `TPromptInputValue` in dag-core if needed to accept object values, or cast appropriately at the translator boundary.

**Step 5: Fix dagRunId = promptId in OrchestratorRunService**

In `packages/dag-orchestrator/src/services/orchestrator-run-service.ts`:
- `createRun` generates a temporary internal `preparationId` (UUID), not called dagRunId
- `startRun(preparationId)` submits to runtime, gets `promptId`, re-keys the run: `dagRunId = promptId`
- All return types use dagRunId (= promptId)
- `getPromptIdForRun` becomes unnecessary (dagRunId IS promptId)

**Step 6: Build and run tests**

Run: `pnpm --filter @robota-sdk/dag-core build && pnpm --filter @robota-sdk/dag-orchestrator build && pnpm --filter @robota-sdk/dag-orchestrator test`
Expected: PASS

**Step 7: Commit**

```bash
git add packages/dag-orchestrator/src/__tests__/translator-contract.test.ts
git add packages/dag-orchestrator/src/__tests__/run-service-contract.test.ts
git add packages/dag-orchestrator/src/adapters/definition-to-prompt-translator.ts
git add packages/dag-orchestrator/src/services/orchestrator-run-service.ts
git commit -m "feat(dag-orchestrator): add contract tests, fix translator object config, dagRunId=promptId"
```

---

## Phase 3: dag-orchestrator-server

### Task 5: Write dag-orchestrator-server SPEC.md

**Files:**
- Create: `apps/dag-orchestrator-server/docs/SPEC.md`
- Reference: `apps/dag-orchestrator-server/src/routes/*.ts`
- Reference: `apps/dag-orchestrator-server/src/server.ts`

**Step 1: Read all route files and server bootstrap**

**Step 2: Write SPEC.md with all 9 required sections**

Key points:
1. Scope — Robota API gateway; orchestrates DAG definition lifecycle and run execution over a ComfyUI-compatible backend
2. Boundaries — does NOT own runtime execution; does NOT own domain types (dag-core); does NOT own orchestration logic (dag-orchestrator pkg)
3. Architecture Overview — Express app, route modules, orchestrator service injection, ComfyUI proxy
4. Type Ownership — no SSOT types (uses dag-core, dag-api, dag-orchestrator)
5. Public API Surface — Robota API endpoints table:

```markdown
### Robota API Endpoints
| Endpoint | Method | Purpose | Request | Response |
|----------|--------|---------|---------|----------|
| `/v1/dag/definitions` | POST | Create definition | `{ definition }` | `{ ok, status, data: { definition } }` |
| ...

### ComfyUI Proxy Endpoints
| Endpoint | Method | Backend Target |
|----------|--------|---------------|
| `/prompt` | POST | POST /prompt |
| ...

### WebSocket
| URL | Protocol | Envelope |
|-----|----------|----------|
| `/v1/dag/runs/:dagRunId/ws` | ws | `{ event: TRunProgressEvent }` |
```

6. Extension Points — INodeCatalogService, IAssetStore implementations
7. Error Taxonomy — IProblemDetails format, error code → HTTP status mapping table
8. Test Strategy — current: 1 test (event translator); planned: endpoint contract tests
9. Class Contract Registry

**Step 3: Verify against code and commit**

```bash
git add apps/dag-orchestrator-server/docs/SPEC.md
git commit -m "docs(dag-orchestrator-server): add SPEC.md with Robota API contract"
```

---

### Task 6: Write dag-orchestrator-server endpoint contract tests

**Files:**
- Create: `apps/dag-orchestrator-server/src/__tests__/endpoint-contract.test.ts`
- Reference: `apps/dag-orchestrator-server/docs/SPEC.md`

**Step 1: Write contract tests**

Test response shapes for key endpoints:
- `POST /v1/dag/runs` → `{ ok: true, status: 201, data: { dagRunId } }`
- `GET /v1/dag/runs/:id/result` (success) → `{ ok: true, status: 200, data: { run: { dagRunId, status, traces, nodeErrors, totalCostUsd } } }`
- `GET /v1/dag/runs/:id/result` (failed) → `{ ok: true, status: 200, data: { run: { status: 'failed', nodeErrors: [...] } } }`
- Error responses → `{ ok: false, status: 4xx, errors: [{ type, title, status, detail, instance, code, retryable }] }`
- `GET /v1/dag/definitions` → `{ ok: true, data: { items: [...] } }`

**Step 2: Run tests, fix any shape mismatches, verify pass**

Run: `pnpm --filter @robota-sdk/dag-orchestrator-server test`

**Step 3: Update ws-routes and run-routes for dagRunId = promptId**

In `apps/dag-orchestrator-server/src/routes/ws-routes.ts`:
- Accept preparationId in URL (for pre-start WS routing)
- Use `runService.getDagRunId(preparationId)` to get actual dagRunId (= promptId)
- Pass dagRunId (= promptId) to event translator

In `apps/dag-orchestrator-server/src/routes/run-routes.ts`:
- `POST /v1/dag/runs` returns `{ preparationId }` (not dagRunId)
- `POST /v1/dag/runs/:id/start` returns `{ dagRunId }` where dagRunId = promptId
- `GET /v1/dag/runs/:dagRunId/result` uses dagRunId to look up result

**Step 4: Build, test, commit**

Run: `pnpm --filter @robota-sdk/dag-orchestrator-server build && pnpm --filter @robota-sdk/dag-orchestrator-server test`

```bash
git add apps/dag-orchestrator-server/src/__tests__/endpoint-contract.test.ts
git add apps/dag-orchestrator-server/src/routes/ws-routes.ts
git add apps/dag-orchestrator-server/src/routes/run-routes.ts
git commit -m "feat(dag-orchestrator-server): add endpoint contract tests, dagRunId=promptId in routes"
```

---

## Phase 4: dag-designer

### Task 7: Update dag-designer SPEC.md

**Files:**
- Modify: `packages/dag-designer/docs/SPEC.md`
- Reference: `apps/dag-orchestrator-server/docs/SPEC.md` (just written)

**Step 1: Update SPEC.md**

Changes:
- Run client contract: update to reflect `status` and `nodeErrors` in IRunResult
- Type Ownership: `IRunResult` imported from `dag-core` (not `dag-server-core` which is deleted)
- Architecture Overview: change "EventSource for SSE" to "WebSocket for progress streaming"
- Remove any SSE references; confirm WS protocol with envelope `{ event: TRunProgressEvent }`
- Update `IDesignerApiClient` contract to reflect:
  - `createRun` returns `{ preparationId }` (for WS subscription)
  - `startRun` returns `{ dagRunId }` (= promptId)
  - `getRunResult` uses dagRunId
  - `subscribeRunProgress` uses preparationId for WS URL

**Step 2: Verify against code and commit**

```bash
git add packages/dag-designer/docs/SPEC.md
git commit -m "docs(dag-designer): update SPEC.md for WS protocol and IRunResult changes"
```

---

### Task 8: Write dag-designer API client contract tests

**Files:**
- Create: `packages/dag-designer/src/__tests__/designer-api-contract.test.ts`
- Reference: `packages/dag-designer/docs/SPEC.md`

**Step 1: Write contract tests**

Test `hasValidRunResult` and response parsing:
- Valid success result: `{ dagRunId, status: 'success', traces: [...], nodeErrors: [], totalCostUsd }` → passes
- Valid failed result: `{ dagRunId, status: 'failed', traces: [], nodeErrors: [...], totalCostUsd }` → passes
- Missing `status` field → fails validation
- Missing `nodeErrors` field → fails validation
- Error response parsing: `{ ok: false, errors: [IProblemDetails] }` → returns error result

**Step 2: Update designer client and screen for preparationId/dagRunId split**

In `packages/dag-designer/src/client/designer-api-client.ts`:
- `createRun` returns `{ preparationId }` (rename from dagRunId)
- `startRun` accepts preparationId, returns `{ dagRunId }`
- `subscribeRunProgress` uses preparationId in WS URL
- `getRunResult` uses dagRunId

In `packages/dag-designer/src/contracts/designer-api.ts`:
- Update `IDesignerCreateRunInput` → rename
- Update `IDesignerStartRunInput` to accept preparationId
- `startRun` returns `{ dagRunId }`

In `apps/web/src/app/dag-designer/_components/dag-designer-screen.tsx`:
- Update `runOnServer` flow: createRun → subscribe WS (preparationId) → startRun → get dagRunId

**Step 3: Build and test all**

Run: `pnpm --filter @robota-sdk/dag-designer build && pnpm --filter @robota-sdk/dag-designer test`

**Step 4: Commit**

```bash
git add packages/dag-designer/src/__tests__/designer-api-contract.test.ts
git add packages/dag-designer/src/client/designer-api-client.ts
git add packages/dag-designer/src/contracts/designer-api.ts
git add apps/web/src/app/dag-designer/_components/dag-designer-screen.tsx
git commit -m "feat(dag-designer): add API contract tests, update for preparationId/dagRunId split"
```

---

## Phase 5: Final verification

### Task 9: Full build and test verification

**Step 1: Build all affected packages in dependency order**

```bash
pnpm --filter @robota-sdk/dag-core build
pnpm --filter @robota-sdk/dag-orchestrator build
pnpm --filter @robota-sdk/dag-designer build
```

**Step 2: Typecheck**

```bash
pnpm typecheck
```

**Step 3: Run all tests**

```bash
pnpm test
```

**Step 4: Verify all SPEC.md files exist**

```bash
ls apps/dag-runtime-server/docs/SPEC.md
ls apps/dag-orchestrator-server/docs/SPEC.md
ls packages/dag-orchestrator/docs/SPEC.md
ls packages/dag-designer/docs/SPEC.md
```

**Step 5: Commit any final fixes**

---

## Test Strategy

- **Phase 1:** Runtime endpoint contract tests validate ComfyUI-compatible response shapes
- **Phase 2:** Translator contract tests catch object config dropping; run service tests verify state transitions and dagRunId=promptId
- **Phase 3:** Orchestrator server endpoint contract tests validate Robota API response envelope and IProblemDetails format
- **Phase 4:** Designer client contract tests validate response parsing for both success and failed runs
- **Phase 5:** Full workspace build + typecheck + test as integration gate
- **Verification:** `pnpm typecheck && pnpm test` must pass after every phase commit
