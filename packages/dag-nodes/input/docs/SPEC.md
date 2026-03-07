# Input Node Specification

## Scope
- Owns the `input` DAG node package for Robota.
- Provides node-level behavior for canonical DAG input values and entry payload handling.

## Boundaries
- Must follow `AbstractNodeDefinition`, `NodeIoAccessor`, and DAG error code conventions.
- Does not become the owner of downstream transformation or provider behavior.
