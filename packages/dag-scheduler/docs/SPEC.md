# DAG Scheduler Specification

## Scope
- Owns schedule evaluation and run trigger timing.
- Computes scheduling windows and logical run times.

## Boundaries
- Depends on `dag-core` contracts.
- Does not execute task payloads directly.
