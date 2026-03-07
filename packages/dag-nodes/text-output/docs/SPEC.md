# Text Output Node Specification

## Scope

- Owns the `text-output` DAG node definition.
- Provides a sink node that receives text input and passes it through as output. Serves as the canonical DAG terminal node for text-based workflows.

## Boundaries

- Extends `AbstractNodeDefinition` from `dag-core`. Does not redefine core DAG contracts.
- Uses `NodeIoAccessor.requireInputString` for input validation.
- No external provider dependencies. Category: `Core`.

## Architecture Overview

- `TextOutputNodeDefinition` — node that accepts a `text` string input and produces a `text` string output (pass-through).
- Validates that the `text` input is a string via `NodeIoAccessor.requireInputString`.
- Copies the validated input value directly to the output port.

## Type Ownership

| Type | Location | Purpose |
|------|----------|---------|
| `TextOutputNodeDefinition` | `src/index.ts` | Node definition class |

## Public API Surface

- `TextOutputNodeDefinition` — class

## Extension Points

- Extends `AbstractNodeDefinition` and overrides `estimateCostWithConfig` (zero cost) and `executeWithConfig`.
- No constructor options. No environment variable dependencies.
- Config schema is empty (`z.object({})`).

## Error Taxonomy

| Code | Layer | Description |
|------|-------|-------------|
| `DAG_VALIDATION_INPUT_*` | Validation | Inherited from `NodeIoAccessor.requireInputString` when text input is missing or not a string |

## Test Strategy

- No test files exist yet. Coverage status: none.
- Recommended: unit tests verifying text pass-through behavior, validation rejection for missing or non-string input, and output structure via `NodeIoAccessor`.
