# @robota-sdk/dag-scheduler

Scheduled triggering for the DAG engine: single scheduled runs, batches, and catch-up over a date
range with fixed-interval slots. `SchedulerTriggerService` validates the request and hands each run to
`dag-runtime`'s `RunOrchestratorService`, which creates it.

Internal package: private to this monorepo (`"private": true`) and not published to npm. It is part of
the DAG workflow subsystem; see [the DAG packages](../dag-core/README.md#the-dag-packages).

## Where it sits

- Depends on: [`@robota-sdk/dag-core`](../dag-core/README.md) and
  [`@robota-sdk/dag-runtime`](../dag-runtime/README.md) (for `RunOrchestratorService`).
- Used by: no composition in this repository wires it in; `createDagFramework()` does not include
  it. A host that needs scheduled or catch-up runs constructs it around its own
  `RunOrchestratorService`.

It does not parse cron expressions, integrate with an external scheduler, or execute tasks
(`dag-worker` does).

## Main exports

- `SchedulerTriggerService(runOrchestrator)`:
  - `triggerScheduledRun(request)` — starts one run with trigger `scheduled` at the given
    `logicalDate`.
  - `triggerScheduledBatch({ items })` — starts runs in order and stops at the first failure. The
    result is always `ok: true` with `startedRuns` (possibly empty) and, when it stopped early, a
    `partialError`.
  - `triggerCatchup(request)` — starts one run per slot, stepping by `slotIntervalMs` from
    `rangeStartLogicalDate` while the slot is not after `rangeEndLogicalDate`. It validates the
    dates, interval, `maxSlots` and range order before starting anything, and stops at the first
    run that fails to start.
- `IScheduledTriggerRequest`, `IScheduledBatchTriggerRequest`, `IScheduledBatchTriggerResult`,
  `ICatchupTriggerRequest`, `ICatchupTriggerResult` — the request and result shapes.

## Usage

```ts
import type { IClockPort, IQueuePort, IStoragePort } from '@robota-sdk/dag-core';
import { RunOrchestratorService } from '@robota-sdk/dag-runtime';
import { SchedulerTriggerService } from '@robota-sdk/dag-scheduler';

declare const storage: IStoragePort;
declare const queue: IQueuePort;
declare const clock: IClockPort;

const scheduler = new SchedulerTriggerService(new RunOrchestratorService(storage, queue, clock));

// Daily slots: Jan 1, Jan 2 and Jan 3.
const catchup = await scheduler.triggerCatchup({
  dagId: 'nightly-report',
  rangeStartLogicalDate: '2026-01-01T00:00:00.000Z',
  rangeEndLogicalDate: '2026-01-03T00:00:00.000Z',
  slotIntervalMs: 24 * 60 * 60 * 1000,
  maxSlots: 10,
  input: {},
});
if (catchup.ok) console.log(catchup.value.requestedSlotCount); // 3
```

## Documentation

- [docs/README.md](docs/README.md) — overview of this package's docs.
- [docs/SPEC.md](docs/SPEC.md) — purpose, boundaries, the batch and catch-up contract, and the open
  question on catch-up slot semantics.
