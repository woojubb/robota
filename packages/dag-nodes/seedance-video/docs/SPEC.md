# Seedance Video Node Specification

## Scope
- Owns the `seedance-video` DAG node package for Robota.
- Provides node-level config, validation, and execution behavior for Seedance video generation in DAG flows.

## Boundaries
- Must follow `AbstractNodeDefinition`, `NodeIoAccessor`, and DAG error code conventions.
- Keeps ByteDance provider integration explicit without redefining core DAG contracts.
