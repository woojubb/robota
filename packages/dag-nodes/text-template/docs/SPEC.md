# Text Template Node Specification

## Scope
- Owns the `text-template` DAG node package for Robota.
- Provides node-level behavior for deterministic text templating in DAG execution flows.

## Boundaries
- Must follow `AbstractNodeDefinition`, `NodeIoAccessor`, and DAG error code conventions.
- Keeps templating behavior explicit and separate from provider execution logic.
