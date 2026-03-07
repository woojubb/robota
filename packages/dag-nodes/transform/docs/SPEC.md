# Transform Node Specification

## Scope
- Owns the `transform` DAG node package for Robota.
- Provides node-level transformation behavior for canonical DAG payload changes.

## Boundaries
- Must follow `AbstractNodeDefinition`, `NodeIoAccessor`, and DAG error code conventions.
- Does not become the owner of source or sink package behavior.
