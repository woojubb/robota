# DAG Scheduler Specification

## Scope

Owns schedule evaluation, scheduled run triggering, batch triggering, and catchup
logic for DAG runs. Computes scheduling windows, validates time ranges, and delegates
actual run creation to `dag-runtime`'s `RunOrchestratorService`.

## Boundaries

- Depends on `dag-core` for domain contracts, error builders, and port interfaces.
- Depends on `dag-runtime` for `RunOrchestratorService` and `IStartRunResult` (known sibling dependency).
- Does not execute task payloads directly -- that responsibility belongs to `dag-worker`.
- Does not own API response shaping -- that belongs to `dag-api`.
- Does not own cron expression parsing or external scheduler integration (out of scope for this package).

## Architecture Overview

Single-service architecture:

- **SchedulerTriggerService** (`services/scheduler-trigger-service.ts`): Accepts a `RunOrchestratorService` instance via constructor injection. Provides three operations:
  1. `triggerScheduledRun` -- triggers a single scheduled run with a logical date.
  2. `triggerScheduledBatch` -- triggers multiple scheduled runs sequentially, failing fast on any error.
  3. `triggerCatchup` -- computes time slots over a date range at a given interval and triggers a run for each slot. Validates date parsing, interval positivity, slot count limits, and range ordering.

### Behavioral Contracts

#### Catchup Slot Computation

The slot count formula and loop condition must be consistent — i.e., the number of slots the formula predicts must equal the number of iterations the loop produces for all valid inputs.

**Current gap**: The implementation uses `Math.floor(spanMs / interval) + 1` for the slot count and `cursorEpochMs <= rangeEndEpochMs` for the loop condition. When the range exactly aligns with slot boundaries, the `+1` causes the formula to overcount by 1 relative to the actual slots needed. For example, range `[T, T+3000ms]` with 1000ms interval:

- Formula: `Math.floor(3000 / 1000) + 1 = 4`
- Loop (`<=`): slots at T, T+1000, T+2000, T+3000 = 4 iterations

The formula and loop are internally consistent in this case (both produce 4). However, the `+1` creates a bias: a range of `[T, T]` (zero span) produces 1 slot, and each additional interval adds exactly 1 more slot. Whether this "inclusive endpoint" semantics is intended should be clarified. If half-open `[start, end)` semantics are desired instead, both the formula and loop must change together:

- Formula: `Math.ceil(spanMs / slotIntervalMs)`
- Loop: `cursorEpochMs < rangeEndEpochMs`

The chosen semantics must be documented explicitly and the `maxSlots` validation must use the same formula as the loop to prevent discrepancies.

## Type Ownership

This package is SSOT for:

- `IScheduledTriggerRequest` -- single scheduled run request (dagId, version, logicalDate, input)
- `IScheduledBatchTriggerRequest` -- batch of scheduled trigger items
- `IScheduledBatchTriggerResult` -- batch result with started runs
- `ICatchupTriggerRequest` -- catchup request (dagId, version, rangeStart, rangeEnd, slotIntervalMs, maxSlots, input)
- `ICatchupTriggerResult` -- catchup result (requestedSlotCount, startedRuns)

## Public API Surface

- `SchedulerTriggerService` -- main service class
  - `constructor(runOrchestrator: RunOrchestratorService)` -- accepts a pre-configured runtime orchestrator
  - `triggerScheduledRun(request): Promise<TResult<IStartRunResult, IDagError>>`
  - `triggerScheduledBatch(request): Promise<TResult<IScheduledBatchTriggerResult, IDagError>>`
  - `triggerCatchup(request): Promise<TResult<ICatchupTriggerResult, IDagError>>`

## Extension Points

- Accepts a `RunOrchestratorService` instance via constructor injection. The orchestrator itself accepts `IStoragePort`, `IQueuePort`, and `IClockPort` from `dag-core`, allowing consumers to provide custom port implementations for different storage/queue backends.
- No abstract classes to extend; the service is used directly.

## Error Taxonomy

All errors use `IDagError` from `dag-core` with `category: 'validation'`:

- `DAG_VALIDATION_INVALID_LOGICAL_DATE` -- catchup range dates are not valid ISO-8601
- `DAG_VALIDATION_INVALID_SLOT_INTERVAL` -- `slotIntervalMs` is zero or negative
- `DAG_VALIDATION_INVALID_MAX_SLOTS` -- `maxSlots` is zero or negative
- `DAG_VALIDATION_INVALID_CATCHUP_RANGE` -- end date is before start date
- `DAG_VALIDATION_CATCHUP_RANGE_EXCEEDS_LIMIT` -- computed slot count exceeds `maxSlots`

Additionally, errors from `RunOrchestratorService.startRun()` propagate directly (definition not found, state transition errors, dispatch errors).

## Class Contract Registry

### Interface Implementations

No classes in this package use the `implements` keyword. All port dependencies are consumed via constructor injection.

### Inheritance Chains

None. Service classes are standalone (no `extends`).

### Service Dependency via DI

| Service Class | Injected Dependency | Location |
|---------------|---------------------|----------|
| `SchedulerTriggerService` | `RunOrchestratorService` (dag-runtime) | `src/services/scheduler-trigger-service.ts` |

### Cross-Package Dependencies

| Dependency (Owner) | Consumer Class | Location |
|--------------------|---------------|----------|
| `RunOrchestratorService` (dag-runtime) | `SchedulerTriggerService` | `src/services/scheduler-trigger-service.ts` |
| `IStartRunResult` (dag-runtime) | `SchedulerTriggerService` | `src/services/scheduler-trigger-service.ts` |

## Test Strategy

- **Unit tests**: `scheduler-trigger-service.test.ts`
- **Integration tests**: `scheduler-integration-e2e.test.ts`
- Tests use in-memory port implementations from `dag-core`.
- Coverage focus: single trigger delegation, batch sequential execution with fail-fast, catchup slot computation, input validation (date parsing, interval, slot limits, range ordering), error propagation from runtime.
- Run: `pnpm --filter @robota-sdk/dag-scheduler test`
