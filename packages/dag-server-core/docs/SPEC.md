# DAG Server Core Specification

## Scope
- Owns reusable DAG server bootstrap, shared server composition, and runtime assembly behavior for Robota.

## Boundaries
- Does not own DAG domain contracts that belong to `dag-core`.
- Keeps reusable server wiring separate from app-specific deployment concerns.
