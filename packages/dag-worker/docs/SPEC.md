# DAG Worker Specification

## Scope
- Owns dequeue/process loop for task execution.
- Applies lease, retry, timeout, and terminalization behavior.

## Boundaries
- Uses core/runtime contracts only.
- Does not define API or DAG definition contracts.
