# DAG Runtime Specification

## Scope
- Owns run orchestration flow and ready-task planning.
- Dispatches executable tasks through core ports.

## Boundaries
- Depends on `dag-core` contracts.
- Does not own worker loops or API transport.
