# OpenAI LLM Text Node Specification

## Scope
- Owns the `llm-text-openai` DAG node package for Robota.
- Provides node-level config, validation, and execution behavior for OpenAI-backed text generation in DAG flows.

## Boundaries
- Must follow `AbstractNodeDefinition`, `NodeIoAccessor`, and DAG error code conventions.
- Keeps OpenAI-specific provider behavior explicit without redefining agent or DAG core contracts.
