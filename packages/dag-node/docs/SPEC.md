# DAG Node Specification

## Scope

`@robota-sdk/dag-node` is the node authoring infrastructure package for the Robota DAG system. It provides the abstract base class, lifecycle wrappers, registries, IO accessors, value objects, and helper functions that node implementors use to build concrete node definitions. This package sits between `dag-core` (which owns the domain contracts and interfaces) and `dag-nodes` (which contains the concrete node implementations).

## Boundaries

- **No domain contracts.** Interfaces (`IDagNodeDefinition`, `INodeLifecycle`, `INodeTaskHandler`, etc.), type definitions, state machines, and error builders belong to `@robota-sdk/dag-core`.
- **No concrete node implementations.** Specific node types (e.g., `llm-text-openai`, `image-source`) belong to `@robota-sdk/dag-nodes`.
- **No orchestration or runtime.** DAG scheduling, worker execution, and run coordination belong to `dag-runtime`, `dag-worker`, `dag-scheduler`.
- **No API layer.** HTTP/REST composition belongs to application packages.
- **No execution engine or lifecycle runner.** The `NodeLifecycleRunner` and `LifecycleTaskExecutorPort` belong to `@robota-sdk/dag-core`.

## Architecture Overview

### Layer Structure

```
dag-node/
  src/
    lifecycle/           -- Abstract base class, IO accessor, lifecycle wrappers, factory
    registry/            -- Static manifest registry
    schemas/             -- Zod schemas for media references
    utils/               -- Node descriptor (buildConfigSchema)
    value-objects/       -- MediaReference immutable value object
    node-definition-assembly.ts -- buildNodeDefinitionAssembly factory
    port-definition-helpers.ts  -- Binary port definition factory and presets
    __tests__/           -- Unit tests
```

### Design Patterns

- **Abstract template pattern**: `AbstractNodeDefinition<TSchema>` provides a config-parsing template that automatically validates node config against a Zod schema before delegating to `*WithConfig` methods. This ensures every lifecycle step receives a typed, validated config object.
- **Adapter pattern**: `RegisteredNodeLifecycle` wraps an `INodeTaskHandler` (partial interface) into a full `INodeLifecycle` with base port validation for inputs and outputs.
- **Factory pattern**: `StaticNodeLifecycleFactory` creates `INodeLifecycle` instances by looking up handlers in a registry and wrapping them.
- **Registry pattern**: `StaticNodeManifestRegistry` and `StaticNodeTaskHandlerRegistry` provide in-memory lookup for node manifests and task handlers by node type.
- **Value object pattern**: `MediaReference` is an immutable object with factory methods (`fromAssetReference`, `fromBinary`, `fromCandidate`) and no public constructor.
- **Result pattern**: All operations that can fail return `TResult<T, IDagError>` instead of throwing.

## Type Ownership

Types owned by this package (defined here, not imported):

| Type | Location | Purpose |
|------|----------|---------|
| `IMediaReferenceCandidate` | `value-objects/media-reference.ts` | Loosely-typed input for creating a `MediaReference` |
| `IParsedBinaryValue` | `lifecycle/binary-value-parser.ts` | Validated binary port value with kind, MIME type, and URI |
| `IBinaryPortPreset` | `port-definition-helpers.ts` | Pre-configured binary kind and MIME type combination |
| `IBinaryPortDefinitionInput` | `port-definition-helpers.ts` | Input for `createBinaryPortDefinition` factory |

Types imported from `@robota-sdk/dag-core` (not owned):

| Type | Purpose |
|------|---------|
| `IDagNodeDefinition` | Interface that `AbstractNodeDefinition` implements |
| `INodeLifecycle` | Interface that `RegisteredNodeLifecycle` implements |
| `INodeLifecycleFactory` | Interface that `StaticNodeLifecycleFactory` implements |
| `INodeTaskHandler` | Partial lifecycle handler interface |
| `INodeTaskHandlerRegistry` | Interface that `StaticNodeTaskHandlerRegistry` implements |
| `INodeManifestRegistry` | Interface that `StaticNodeManifestRegistry` implements |
| `INodeManifest` | Node registration manifest |
| `INodeExecutionContext` | Execution context passed to lifecycle methods |
| `ICostEstimate` | Cost estimate returned from `estimateCost` |
| `TResult<T, E>` | Discriminated union result type |
| `IDagError` | Canonical error structure |
| `TPortPayload`, `TPortValue` | Port value types |
| `IPortDefinition` | Port schema definition |
| `IPortBinaryValue` | Binary port value structure |
| `TAssetReference`, `TAssetReferenceType`, `TBinaryKind` | Asset and binary kind types |

## Public API Surface

| Export | Kind | Description |
|--------|------|-------------|
| `AbstractNodeDefinition<TSchema>` | Abstract class | Base class for all node implementations; parses config via Zod, delegates to `*WithConfig` template methods |
| `NodeIoAccessor` | Class | Typed accessor for reading input values and building output payloads within node execution |
| `RegisteredNodeLifecycle` | Class | Wraps an `INodeTaskHandler` into a full `INodeLifecycle` with base port validation |
| `StaticNodeLifecycleFactory` | Class | Creates `INodeLifecycle` instances from a static handler registry |
| `StaticNodeTaskHandlerRegistry` | Class | In-memory registry of `INodeTaskHandler` by node type |
| `StaticNodeManifestRegistry` | Class | In-memory registry of `INodeManifest` by node type |
| `MediaReference` | Value object | Immutable media reference with factory methods and conversion helpers |
| `MediaReferenceSchema` | Zod schema | Zod validation schema for media reference config |
| `createMediaReferenceConfigSchema` | Function | Creates a Zod schema wrapping `MediaReferenceSchema` under an `asset` key |
| `parseBinaryValue` | Function | Parses and validates a raw port value as a binary payload |
| `createBinaryPortDefinition` | Function | Creates an `IPortDefinition` for binary ports using a preset |
| `BINARY_PORT_PRESETS` | Constant | Predefined binary port presets (IMAGE_PNG, IMAGE_COMMON, VIDEO_MP4, etc.) |
| `buildNodeDefinitionAssembly` | Function | Builds manifests and handler registry from an array of `IDagNodeDefinition` |
| `buildConfigSchema` | Function | Converts a Zod schema to JSON Schema 7 for node config |
| `createStaticNodeLifecycleFactory` | Function | Factory function that creates a `StaticNodeLifecycleFactory` from a handler map |

## Extension Points

### AbstractNodeDefinition\<TSchema\>

The primary extension point for node implementors. Concrete node classes must:

1. Extend `AbstractNodeDefinition<TSchema>` where `TSchema` is a Zod schema type.
2. Declare `nodeType`, `displayName`, `category`, `inputs`, `outputs`, and `configSchemaDefinition`.
3. Implement `executeWithConfig(input, context, config)` -- the core execution logic.
4. Implement `estimateCostWithConfig(input, context, config)` -- cost estimation before execution.
5. Optionally override `initializeWithConfig`, `validateInputWithConfig`, `validateOutputWithConfig`, and `disposeWithConfig`.

The base class automatically parses and validates node config against the Zod schema before delegating to any `*WithConfig` method. Config parse failures produce `DAG_VALIDATION_NODE_CONFIG_SCHEMA_INVALID` errors.

### NodeIoAccessor

Provides typed input reading within node execution:

- `requireInput(key)` / `requireInputString(key)` / `requireInputArray(key)` -- scalar and array access with validation errors.
- `requireInputBinary(key, kind?)` / `requireInputBinaryList(key, kind?, options?)` -- binary payload access with kind and MIME-type validation.
- `requireInputMediaReference(key, options?)` / `requireInputBinaryReference(key, kind?)` -- media reference access returning `MediaReference` value objects.
- `setOutput(key, value)` / `toOutput()` -- output assembly.

### INodeTaskHandler

A lighter alternative to full `INodeLifecycle`. Only `execute` is required; all other lifecycle methods are optional. The `RegisteredNodeLifecycle` wrapper fills in defaults and adds base port validation for handlers that omit `validateInput`/`validateOutput`.

## Error Taxonomy

All errors use codes and categories defined in `@robota-sdk/dag-core`. This package produces errors in the following categories:

### Validation Errors (category: `validation`, retryable: `false`)

| Code | Source | Description |
|------|--------|-------------|
| `DAG_VALIDATION_NODE_CONFIG_SCHEMA_INVALID` | `AbstractNodeDefinition` | Node config fails Zod schema parse |
| `DAG_VALIDATION_NODE_INPUT_MISSING` | `NodeIoAccessor` | Required input key is missing |
| `DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH` | `NodeIoAccessor`, `RegisteredNodeLifecycle` | Input value type does not match port type |
| `DAG_VALIDATION_NODE_INPUT_MIN_ITEMS_NOT_SATISFIED` | `NodeIoAccessor`, `RegisteredNodeLifecycle` | List input has fewer items than minItems |
| `DAG_VALIDATION_NODE_INPUT_MAX_ITEMS_EXCEEDED` | `NodeIoAccessor`, `RegisteredNodeLifecycle` | List input has more items than maxItems |
| `DAG_VALIDATION_NODE_REQUIRED_INPUT_MISSING` | `RegisteredNodeLifecycle` | Required input port value is missing |
| `DAG_VALIDATION_NODE_REQUIRED_OUTPUT_MISSING` | `RegisteredNodeLifecycle` | Required output port value is missing |
| `DAG_VALIDATION_NODE_OUTPUT_TYPE_MISMATCH` | `RegisteredNodeLifecycle` | Output value type does not match port type |
| `DAG_VALIDATION_NODE_OUTPUT_MIN_ITEMS_NOT_SATISFIED` | `RegisteredNodeLifecycle` | List output has fewer items than minItems |
| `DAG_VALIDATION_NODE_OUTPUT_MAX_ITEMS_EXCEEDED` | `RegisteredNodeLifecycle` | List output has more items than maxItems |
| `DAG_VALIDATION_NODE_LIFECYCLE_NOT_REGISTERED` | `StaticNodeLifecycleFactory` | No lifecycle registered for node type |
| `DAG_VALIDATION_MEDIA_REFERENCE_INVALID` | `MediaReference` | Media reference structure is invalid |
| `DAG_VALIDATION_MEDIA_REFERENCE_XOR_REQUIRED` | `MediaReference` | Exactly one of assetId or uri must be provided |
| `DAG_VALIDATION_MEDIA_REFERENCE_TYPE_MISMATCH` | `MediaReference` | referenceType does not match provided fields |

## Class Contract Registry

### Interface Implementations

| Interface (Owner) | Implementor | Kind | Location |
|-----------|------------|------|----------|
| `IDagNodeDefinition` (dag-core) | `AbstractNodeDefinition` | abstract base | `src/lifecycle/abstract-node-definition.ts` |
| `INodeLifecycle` (dag-core) | `RegisteredNodeLifecycle` | production | `src/lifecycle/registered-node-lifecycle.ts` |
| `INodeLifecycleFactory` (dag-core) | `StaticNodeLifecycleFactory` | production | `src/lifecycle/static-node-lifecycle-factory.ts` |
| `INodeManifestRegistry` (dag-core) | `StaticNodeManifestRegistry` | production | `src/registry/static-node-manifest-registry.ts` |
| `INodeTaskHandlerRegistry` (dag-core) | `StaticNodeTaskHandlerRegistry` | production | `src/lifecycle/default-node-task-handlers.ts` |

### Cross-Package Consumers

| Export (This Package) | Consumer Package | Notes |
|-----------------------|-----------------|-------|
| `AbstractNodeDefinition` | `dag-nodes` (11 node definitions) | Each implements `executeWithConfig` and `estimateCostWithConfig` |
| `NodeIoAccessor` | `dag-nodes` (11 node definitions) | Used for input reading and output assembly |
| `MediaReference` | `dag-nodes` (media-handling nodes) | Used for asset reference handling |
| `BINARY_PORT_PRESETS`, `createBinaryPortDefinition` | `dag-nodes` (binary-handling nodes) | Used for port definitions |
| `buildNodeDefinitionAssembly` | `dag-runtime-server`, `dag-orchestrator-server` | Builds manifests + handler map from node definitions |
| `StaticNodeLifecycleFactory`, `StaticNodeTaskHandlerRegistry` | `dag-runtime-server` | Creates lifecycle instances for node execution |

## Dependencies

| Dependency | Purpose |
|------------|---------|
| `@robota-sdk/dag-core` | Domain contracts, interfaces, error builders, type definitions |
| `zod` | Runtime schema validation for node configs and media references |
| `zod-to-json-schema` | Converts Zod schemas to JSON Schema 7 for manifest `configSchema` |

## Test Strategy

### Current Test Files

| File | Coverage |
|------|----------|
| `__tests__/abstract-node-definition.test.ts` | Config parsing, `*WithConfig` delegation, config validation error generation |
| `__tests__/node-io-accessor.test.ts` | `requireInput*` methods, binary access, media reference access, output assembly |
| `__tests__/registered-node-lifecycle.test.ts` | Port validation (required ports, type matching, list constraints), handler delegation |
| `__tests__/static-node-lifecycle-factory.test.ts` | Factory creation from registry, missing handler error |
| `__tests__/static-node-manifest-registry.test.ts` | Manifest lookup, listing |
| `__tests__/media-reference.test.ts` | Factory methods, XOR validation, conversion helpers |
| `__tests__/media-reference-schema.test.ts` | Zod schema validation for media references |
| `__tests__/binary-value-parser.test.ts` | Binary value parsing and validation |
| `__tests__/node-descriptor.test.ts` | `buildConfigSchema` Zod-to-JSON-Schema conversion and validation |
| `__tests__/node-definition-assembly.test.ts` | `buildNodeDefinitionAssembly` assembly, port definition helpers, presets |
