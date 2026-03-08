# Image Loader Node Specification

## Scope

- Owns the `image-loader` DAG node definition.
- Converts a media reference object input into a binary image output suitable for downstream image-processing nodes.

## Boundaries

- Extends `AbstractNodeDefinition` from `dag-core`. Does not redefine core DAG contracts.
- Uses `NodeIoAccessor.requireInputMediaReference` for input validation.
- Uses `createBinaryPortDefinition` with `BINARY_PORT_PRESETS.IMAGE_COMMON` for the output port.
- No external provider dependencies. Pure data transformation node.

## Architecture Overview

- `ImageLoaderNodeDefinition` — single class that accepts an `asset` object input (media reference) and produces an `image` binary output.
- Delegates media reference parsing to `NodeIoAccessor.requireInputMediaReference`, which returns a `MediaReference` value object.
- Converts the reference to binary via `MediaReference.toBinary('image', 'image/png')`.

## Type Ownership

| Type | Location | Purpose |
|------|----------|---------|
| `ImageLoaderNodeDefinition` | `src/index.ts` | Node definition class |

## Public API Surface

- `ImageLoaderNodeDefinition` — class

## Extension Points

- Extends `AbstractNodeDefinition` and overrides `estimateCostWithConfig` (zero cost) and `executeWithConfig`.
- No constructor options. No environment variable dependencies.
- Config schema is empty (`z.object({})`).

## Error Taxonomy

| Code | Layer | Description |
|------|-------|-------------|
| `DAG_VALIDATION_INPUT_*` | Validation | Inherited from `NodeIoAccessor.requireInputMediaReference` when input is missing or invalid |

## Test Strategy

- No test files exist yet. Coverage status: none.
- Recommended: unit tests verifying media reference conversion to binary output, and validation failure when input is missing or malformed.
