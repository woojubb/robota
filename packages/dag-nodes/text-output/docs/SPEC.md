# Text Output Node Specification

## Scope
- Owns the `text-output` DAG node package for Robota.
- Provides node-level behavior for emitting canonical text outputs from DAG execution flows.

## Boundaries
- Must follow `AbstractNodeDefinition`, `NodeIoAccessor`, and DAG error code conventions.
- Does not become the owner of upstream generation or template behavior.
