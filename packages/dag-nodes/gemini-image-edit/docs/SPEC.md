# Gemini Image Edit Node Specification

## Scope
- Owns the `gemini-image-edit` DAG node package for Robota.
- Provides node-level config, validation, and execution behavior for Gemini-based image editing.

## Boundaries
- Must follow `AbstractNodeDefinition`, `NodeIoAccessor`, and DAG error code conventions.
- Keeps Google provider integration explicit without redefining core DAG contracts.
