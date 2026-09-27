# DAG Scheduler

Scheduled, batch and catch-up run triggering for the DAG engine. `SchedulerTriggerService` validates
each request and delegates run creation to `dag-runtime`'s `RunOrchestratorService`.

`@robota-sdk/dag-scheduler` computes scheduling windows and checks time ranges. It does not execute
tasks (`dag-worker`), shape API responses (`dag-api`), parse cron expressions or integrate with an
external scheduler.

## Documents

- [SPEC.md](SPEC.md) — purpose, boundaries, the batch and catch-up contract, and the open design
  question on catch-up slot semantics.
- [Package README](../README.md) — main exports and a usage example.
