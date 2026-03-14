# Design: Spec-First Refactoring for DAG Servers and Designer

**Date:** 2026-03-14
**Status:** Approved

## Problem

Three critical packages lack specification documents and contract tests:
- `dag-runtime-server` — no SPEC.md, no tests, ComfyUI-compatible API undocumented
- `dag-orchestrator-server` — no SPEC.md, 1 test file, Robota API undocumented
- `dag-orchestrator` (package) — no SPEC.md, orchestration contracts implicit
- `dag-designer` — SPEC.md exists but outdated (missing new IRunResult fields, SSE/WS mismatch)

Without governing specs, code changes drift from intended contracts (e.g., translator dropping object configs, dagRunId identity confusion).

## Design

### Execution Order

Specs are written bottom-up following the contract dependency direction:

```
Phase 1: dag-runtime-server SPEC
    ← ComfyUI reference (.design/dag-benchmark/03-comfyui.md)
Phase 2: dag-orchestrator (package) SPEC
    ← runtime spec defines IPromptApiClientPort contract
Phase 3: dag-orchestrator-server SPEC
    ← orchestrator package + Robota API definition
Phase 4: dag-designer SPEC update
    ← orchestrator-server spec defines client contract
```

### Phase 1: dag-runtime-server

**SPEC.md scope:**
- All ComfyUI-compatible endpoints (12 HTTP + 1 WS) with implementation status
- Error response format = ComfyUI native (not IProblemDetails)
- WS event types (6 ComfyUI message types)
- Port implementations (IStoragePort, ITaskExecutorPort, IAssetStore, INodeCatalogService)
- Reference: `.design/dag-benchmark/03-comfyui.md`

**Contract tests:**
- Each endpoint response shape vs ComfyUI spec
- WS message format
- Error response format

### Phase 2: dag-orchestrator (package)

**SPEC.md scope:**
- `IPromptApiClientPort` — contract for ComfyUI API consumption
- `OrchestratorRunService` — run lifecycle (create → start → recordEvent → getResult)
- `translateDefinitionToPrompt` — translation rules including object config handling
- dagRunId = promptId principle
- Type ownership: dag-core owns IRunResult/IRunNodeError, this package composes

**Contract tests:**
- Translator input/output contract (including nested object configs)
- Run service state transitions
- IPromptApiClientPort implementation contract

### Phase 3: dag-orchestrator-server

**SPEC.md scope:**
- Robota API endpoints: definition CRUD (7) + run (4) + asset (3) + admin (1) + WS (1)
- Response envelope: success `{ ok, status, data }`, error `{ ok, status, errors: IProblemDetails[] }`
- WS progress streaming protocol: envelope `{ event: TRunProgressEvent }`
- ComfyUI proxy endpoints (6 pass-through)
- Error code → HTTP status mapping

**Contract tests:**
- Each endpoint response shape
- IProblemDetails format consistency
- WS event envelope format

### Phase 4: dag-designer SPEC update

**Scope:**
- Sync `IDesignerApiClient` with orchestrator-server spec
- Remove SSE references, confirm WS protocol
- Reflect new IRunResult fields (status, nodeErrors)

**Contract tests:**
- API client response parsing (success/error)
- WS event parsing

## Decisions

- **Runtime error format = ComfyUI native.** Orchestrator translates to IProblemDetails. This follows the API boundary rule.
- **dagRunId = promptId.** Orchestrator does not generate its own UUID. The runtime's prompt_id is the dagRunId.
- **Bottom-up order.** Each spec depends only on already-written specs below it.
- **SPEC.md per package, not OpenAPI yet.** OpenAPI can be generated later from SPEC.md as a follow-up.

## Test Strategy

- **Per phase:** Each SPEC.md includes a contract test plan. Tests are written before any code refactoring.
- **Verification commands:**
  - Phase 1: `pnpm --filter @robota-sdk/dag-runtime-server test`
  - Phase 2: `pnpm --filter @robota-sdk/dag-orchestrator test`
  - Phase 3: `pnpm --filter @robota-sdk/dag-orchestrator-server test`
  - Phase 4: `pnpm --filter @robota-sdk/dag-designer test`
- **Integrity check:** After all phases, `pnpm typecheck && pnpm test` must pass.
