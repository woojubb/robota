# OK Emitter Node Specification

## Scope

- Owns the `ok-emitter` DAG node definition.
- Provides a test/verification node that accepts a binary image input and emits a string `"ok"` status output. Used to verify upstream image pipeline correctness.

## Boundaries

- Extends `AbstractNodeDefinition` from `dag-node`. Does not redefine core DAG contracts.
- Uses `NodeIoAccessor` from `dag-node` for input validation and output construction.
- Uses `createBinaryPortDefinition` from `dag-node` with `BINARY_PORT_PRESETS.IMAGE_COMMON` from `dag-node` for the input port.
- No external provider dependencies. Category: `Test`.

## Architecture Overview

- `OkEmitterNodeDefinition` — node that accepts an `image` binary input and produces a `status` string output (`"ok"`).
- Overrides `validateInputWithConfig` for early binary image shape validation via `isImageBinary` helper.
- Execution re-validates input via `NodeIoAccessor.requireInput` and `isImageBinary`, then sets `status` to `"ok"`.

## Type Ownership

| Type | Location | Purpose |
|------|----------|---------|
| `OkEmitterNodeDefinition` | `src/index.ts` | Node definition class |

## Public API Surface

- `OkEmitterNodeDefinition` — class

## Extension Points

- Extends `AbstractNodeDefinition` and overrides `validateInputWithConfig`, `estimateCostWithConfig` (zero cost), and `executeWithConfig`.
- No constructor options. No environment variable dependencies.
- Config schema is empty (`z.object({})`).

## Error Taxonomy

| Code | Layer | Description |
|------|-------|-------------|
| `DAG_VALIDATION_OK_EMITTER_IMAGE_REQUIRED` | Validation | Input is not a valid binary image payload |
| `DAG_TASK_EXECUTION_OK_EMITTER_IMAGE_INVALID` | Execution | Image input failed re-validation during execution |

## Test Strategy

- No test files exist yet. Coverage status: none.
- Recommended: unit tests verifying `"ok"` output for valid image input, validation rejection for non-image input, and execution failure for malformed binary payloads.
