# Input Node Specification

## Scope

- Owns the `input` DAG node definition.
- Provides a source node that emits a configured text value as output. Serves as the canonical DAG entry point for text-based workflows.

## Boundaries

- Extends `AbstractNodeDefinition` from `dag-core`. Does not redefine core DAG contracts.
- Uses `NodeIoAccessor` for output construction.
- No external provider dependencies. No inputs (source node).

## Architecture Overview

- `InputNodeDefinition` — source node with zero inputs and one `text` string output.
- Config includes a `text` field (defaults to empty string).
- Execution sets the configured text value as the `text` output port.

## Type Ownership

| Type | Location | Purpose |
|------|----------|---------|
| `InputNodeDefinition` | `src/index.ts` | Node definition class |

## Public API Surface

- `InputNodeDefinition` — class

## Extension Points

- Extends `AbstractNodeDefinition` and overrides `estimateCostWithConfig` (zero cost) and `executeWithConfig`.
- Config schema: `{ text: z.string().default('') }`.
- No constructor options. No environment variable dependencies.

## Error Taxonomy

No node-specific error codes are defined. This node has no validation failure paths beyond base-class config schema parsing.

## Test Strategy

- No test files exist yet. Coverage status: none.
- Recommended: unit tests verifying text output matches config value, empty string default behavior, and `NodeIoAccessor` output structure.
