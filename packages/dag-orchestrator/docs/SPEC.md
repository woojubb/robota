# dag-orchestrator SPEC.md

## Scope

`@robota-sdk/dag-orchestrator` is the orchestration layer that bridges DAG definitions to Prompt API (ComfyUI-compatible) execution. It owns the translation of `IDagDefinition` into `IPromptRequest`, run lifecycle management (create, start, poll, result), cost estimation gating, and HTTP communication with a Prompt API server. This package is backend-agnostic: it works against both the Robota `dag-runtime-server` and a native ComfyUI server through the `IPromptApiClientPort` abstraction.

## Boundaries

| Responsibility | Owner | NOT this package |
|---|---|---|
| DAG domain types (`IDagDefinition`, `IPromptRequest`, `TResult`, `IDagError`, `IRunResult`) | `@robota-sdk/dag-core` | Imported, not owned |
| Runtime execution (node execution, asset storage, queue processing) | `dag-runtime-server` | Not touched |
| HTTP server routing, request handling, SSE/WebSocket events | `dag-orchestrator-server` | Consumer of this package |
| DAG storage and persistence | `dag-orchestrator-server` (in-memory or external) | Not owned |
| UI and designer interactions | `dag-designer`, `web` app | Not owned |
| Node definitions and catalog | `dag-core`, `dag-nodes-*` | Not owned |

## Architecture Overview

The package follows a **ports-and-adapters** architecture with two service layers:

```
index.ts (public surface)
  |
  +-- services/
  |     +-- OrchestratorRunService      (run lifecycle: create, start, poll, result)
  |     +-- PromptOrchestratorService   (prompt submission with cost policy gating)
  |
  +-- adapters/
  |     +-- HttpPromptApiClient         (IPromptApiClientPort -> HTTP fetch)
  |     +-- translateDefinitionToPrompt (IDagDefinition -> IPromptRequest pure function)
  |
  +-- interfaces/
  |     +-- IPromptApiClientPort        (port to Prompt API server)
  |     +-- ICostEstimatorPort          (port for cost estimation)
  |     +-- ICostPolicyEvaluatorPort    (port for cost policy evaluation)
  |
  +-- types/
        +-- orchestrator-types.ts       (SSOT types for orchestration config)
```

**Key design decisions:**

- All public methods return `TResult<T, IDagError>`. No exceptions are thrown for domain failures.
- `OrchestratorRunService` manages run state in-memory via a `Map<string, IRunState>`. It is stateful and scoped to the server process lifetime.
- `PromptOrchestratorService` is stateless; each call delegates to the injected ports.
- `translateDefinitionToPrompt` is a pure function (no side effects, no I/O).

## Type Ownership

Types **owned** by this package (SSOT):

| Type | Location | Purpose |
|---|---|---|
| `ICostEstimate` | `types/orchestrator-types.ts` | Per-prompt cost estimation result |
| `ICostPolicy` | `types/orchestrator-types.ts` | Max cost threshold configuration |
| `IRetryPolicy` | `types/orchestrator-types.ts` | Retry configuration (max retries, backoff, retryable error codes) |
| `ITimeoutPolicy` | `types/orchestrator-types.ts` | Prompt timeout configuration |
| `IOrchestratorConfig` | `types/orchestrator-types.ts` | Combined orchestrator configuration (cost + retry + timeout policies) |
| `IOrchestratedPromptRequest` | `types/orchestrator-types.ts` | Prompt request bundled with orchestrator config |
| `IOrchestratedPromptResponse` | `types/orchestrator-types.ts` | Prompt response bundled with optional cost estimate |
| `IPromptApiClientPort` | `interfaces/prompt-api-client-port.ts` | Port interface for Prompt API server communication |
| `ICostEstimatorPort` | `interfaces/orchestrator-policy-port.ts` | Port interface for cost estimation |
| `ICostPolicyEvaluatorPort` | `interfaces/orchestrator-policy-port.ts` | Port interface for cost policy evaluation |

Types **imported** from `@robota-sdk/dag-core` (not owned here):

`IDagDefinition`, `IDagError`, `IPromptRequest`, `IPromptResponse`, `IQueueStatus`, `IQueueAction`, `THistory`, `TObjectInfo`, `ISystemStats`, `TResult`, `TPortPayload`, `IRunResult`, `IRunNodeTrace`, `IRunNodeError`, `TRunProgressEvent`, `TPromptInputValue`, `TPrompt`, `IDagEdgeDefinition`

## Public API Surface

| Export | Kind | Description |
|---|---|---|
| `PromptOrchestratorService` | class | Stateless orchestrator: submits prompts with optional cost policy gating, delegates queue/history/objectInfo/systemStats to API client |
| `OrchestratorRunService` | class | Stateful run lifecycle manager: createRun, startRun, createAndStartRun, getRunStatus, getRunResult, recordEvent |
| `HttpPromptApiClient` | class | HTTP adapter implementing `IPromptApiClientPort` via `fetch()` |
| `translateDefinitionToPrompt` | function | Pure translator: `IDagDefinition` + `TPortPayload` -> `IPromptRequest` |
| `IPromptApiClientPort` | interface (type export) | Port for Prompt API server communication |
| `ICostEstimatorPort` | interface (type export) | Port for cost estimation logic |
| `ICostPolicyEvaluatorPort` | interface (type export) | Port for cost policy evaluation logic |
| `ICostEstimate` | interface (type export) | Cost estimation result shape |
| `ICostPolicy` | interface (type export) | Cost policy configuration shape |
| `IRetryPolicy` | interface (type export) | Retry policy configuration shape |
| `ITimeoutPolicy` | interface (type export) | Timeout policy configuration shape |
| `IOrchestratorConfig` | interface (type export) | Combined orchestrator configuration |
| `IOrchestratedPromptRequest` | interface (type export) | Request bundled with config |
| `IOrchestratedPromptResponse` | interface (type export) | Response bundled with cost estimate |

## Extension Points

| Port | Purpose | Implementors |
|---|---|---|
| `IPromptApiClientPort` | Communicate with a Prompt API server (ComfyUI or Robota runtime) | `HttpPromptApiClient` (built-in), in-memory stubs (tests) |
| `ICostEstimatorPort` | Estimate execution cost given node types and object info | Consumer-provided; no built-in implementation |
| `ICostPolicyEvaluatorPort` | Evaluate whether an estimated cost passes a policy threshold | Consumer-provided; no built-in implementation |

All three ports are injected via constructor DI. Consumers can provide custom implementations without modifying this package.

## Error Taxonomy

All errors use `IDagError` from `@robota-sdk/dag-core` with `TResult<T, IDagError>` return types.

| Code | Category | Retryable | Source | Description |
|---|---|---|---|---|
| `ORCHESTRATOR_EMPTY_DEFINITION` | `validation` | No | `translateDefinitionToPrompt` | Definition has zero nodes |
| `ORCHESTRATOR_RUN_NOT_FOUND` | `validation` | No | `OrchestratorRunService` | dagRunId does not exist in the run map |
| `ORCHESTRATOR_RUN_ALREADY_STARTED` | `validation` | No | `OrchestratorRunService.startRun` | Attempted to start a run that is not in `pending` status |
| `ORCHESTRATOR_RUN_NOT_COMPLETED` | `validation` | No | `OrchestratorRunService.getRunResult` | Run has not been started or has not completed yet |
| `NETWORK_ERROR` | `dispatch` | Yes | `HttpPromptApiClient` | Failed to connect to Prompt API server |
| `HTTP_<status>` | `validation` | Yes (5xx) / No (4xx) | `HttpPromptApiClient` | Non-OK HTTP response from Prompt API server |
| `COST_LIMIT_EXCEEDED` | `validation` | No | Consumer-provided `ICostPolicyEvaluatorPort` | Cost estimate exceeds policy threshold |

## Test Strategy

### Current test files

| File | Type | Coverage |
|---|---|---|
| `prompt-orchestrator-service.test.ts` | Unit | Submits with/without cost policy, cost rejection, delegation of getQueue/getHistory/getSystemStats |
| `prompt-api-client-port.test.ts` | Contract | Verifies `IPromptApiClientPort` is implementable as an in-memory stub |
| `backend-interchangeability.test.ts` | Contract (integration-style) | Proves `HttpPromptApiClient` works identically against mock Robota and ComfyUI servers; cross-backend response shape parity |

### Coverage gaps

- **`OrchestratorRunService`**: No unit tests. Missing coverage for `createRun`, `startRun`, `createAndStartRun`, `getRunStatus`, `getRunResult`, and `recordEvent`.
- **`translateDefinitionToPrompt`**: No unit tests. Missing coverage for edge binding translation, output slot tracking, input node config merging, and the empty-definition error path.
- **Object config values bug**: `translateDefinitionToPrompt` currently drops non-primitive config values (objects, arrays). The filter at line 44 only passes `string | number | boolean`. The correct behavior is to pass through all config values, including objects and arrays, since ComfyUI prompt inputs can contain complex structures.
- **`dagRunId = promptId` principle**: Current `createRun` generates its own `randomUUID()` for dagRunId instead of using the runtime's `prompt_id`. The orchestrator should use the `prompt_id` returned by `submitPrompt` as the canonical `dagRunId`, eliminating the dual-ID mapping.
- **`recordEvent` accumulation**: `recordEvent` pushes `TRunProgressEvent` into `nodeEvents` and updates run status on `execution.completed` / `execution.failed`. This is used by `getRunResult` to extract `IRunNodeError[]` for failed runs. No tests verify this event-to-error-report pipeline.
- **Failed run result shape**: `getRunResult` for failed runs returns `{ ok: true, value: { status: 'failed', nodeErrors: [...] } }` (not `ok: false`). This is intentional: the operation succeeded in retrieving the result, but the run itself failed. No tests verify this distinction.
- **Retry and timeout policies**: `IRetryPolicy` and `ITimeoutPolicy` are defined in types but not implemented in any service. No tests exist for these paths.

### Verification commands

```bash
pnpm --filter @robota-sdk/dag-orchestrator test
pnpm --filter @robota-sdk/dag-orchestrator build
```

## Class Contract Registry

| Class / Function | Implements / Extends | Port Consumer |
|---|---|---|
| `HttpPromptApiClient` | implements `IPromptApiClientPort` | -- |
| `PromptOrchestratorService` | -- | Injects `IPromptApiClientPort`, `ICostEstimatorPort`, `ICostPolicyEvaluatorPort` |
| `OrchestratorRunService` | -- | Injects `IPromptApiClientPort` |
| `translateDefinitionToPrompt` | pure function (no port) | -- |

### Cross-package consumers

| Consumer (external) | Port consumed | Package |
|---|---|---|
| `dag-orchestrator-server` routes | `OrchestratorRunService`, `PromptOrchestratorService` | `apps/dag-orchestrator-server` |

## Dependencies

| Dependency | Kind | Purpose |
|---|---|---|
| `@robota-sdk/dag-core` | production | Domain types (`IDagDefinition`, `IPromptRequest`, `TResult`, `IDagError`, etc.) |
| `express` | dev | Mock server for backend interchangeability tests |
| `vitest` | dev | Test runner |
| `tsup` | dev | Build tool |
