# Transform Node Specification

## Scope

- Owns the `transform` DAG node definition.
- Provides a general-purpose data transformation node that can prefix text input or pass through arbitrary data within DAG execution flows.

## Boundaries

- Extends `AbstractNodeDefinition` from `dag-core`. Does not redefine core DAG contracts.
- Uses `NodeIoAccessor` for input access and output construction.
- Overrides `validateInputWithConfig` for early empty-input detection.
- No external provider dependencies. Category: `Core`.

## Architecture Overview

- `TransformNodeDefinition` — node with two optional inputs (`text` string, `data` object) and two optional outputs (`text` string, `data` object).
- If `text` input is a string, applies configured `prefix` and emits as `text` output.
- If `text` input is not a string, copies all input entries to output unchanged (pass-through mode).
- Overrides `validateInputWithConfig` to reject empty input payloads.

## Type Ownership

| Type | Location | Purpose |
|------|----------|---------|
| `TransformNodeDefinition` | `src/index.ts` | Node definition class |

## Public API Surface

- `TransformNodeDefinition` — class

## Extension Points

- Extends `AbstractNodeDefinition` and overrides `validateInputWithConfig`, `estimateCostWithConfig` (0.0001 USD), and `executeWithConfig`.
- Config schema: `{ prefix: z.string().default('') }`.
- No constructor options. No environment variable dependencies.

## Error Taxonomy

| Code | Layer | Description |
|------|-------|-------------|
| `DAG_VALIDATION_TRANSFORM_INPUT_REQUIRED` | Validation | Input payload is empty (no keys) |

## Test Strategy

- No test files exist yet. Coverage status: none.
- Recommended: unit tests verifying text prefix application, pass-through mode for non-text input, empty-input validation rejection, and output structure for mixed input types.
