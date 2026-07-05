# Image Source Node Specification

## Scope

- Owns the `image-source` DAG node definition.
- Provides a source node that emits a binary image payload from a configured asset reference. Designed for test and development workflows.

## Boundaries

- Extends `AbstractNodeDefinition` from `dag-node`. Does not redefine core DAG contracts.
- Uses `createMediaReferenceConfigSchema` from `dag-node` for config validation.
- Uses `MediaReference.fromAssetReference` for reference construction and `toBinary` for output conversion.
- Uses `BINARY_PORT_PRESETS.IMAGE_COMMON` from `dag-node` for the output port definition, so the output accepts PNG, JPEG, and WebP image payloads.
- No external provider dependencies. No inputs (source node).

## Architecture Overview

- `ImageSourceNodeDefinition` — source node with zero inputs and one `image` binary output.
- Config includes an `asset` field (from `createMediaReferenceConfigSchema`) and an optional `mimeType` override.
- Constructs a `MediaReference` from the configured asset, resolves MIME type (config override > reference media type > `image/png` default), and emits binary output.

## Type Ownership

| Type                        | Location       | Purpose               |
| --------------------------- | -------------- | --------------------- |
| `ImageSourceNodeDefinition` | `src/index.ts` | Node definition class |

## Public API Surface

- `ImageSourceNodeDefinition` — class

## Extension Points

- Extends `AbstractNodeDefinition` and overrides `estimateCostWithConfig` (zero cost) and `executeWithConfig`.
- Config allows `mimeType` override for the output binary payload.
- No constructor options. No environment variable dependencies.

## Error Taxonomy

No node-specific error codes are defined. Config validation failures are handled by the base-class Zod schema parse. `MediaReference.fromAssetReference` may surface `dag-core` validation errors if the asset config is malformed.

## Test Strategy

- `src/index.test.ts` verifies node metadata, common image MIME output support, binary payload structure, MIME type override behavior, and zero-cost estimation.
