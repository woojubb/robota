# dag-node Package Extraction Design

## Goal

Extract node infrastructure code from `dag-core` into a new `packages/dag-node` (`@robota-sdk/dag-node`) package, establishing clear SSOT boundaries between core DAG contracts and node authoring infrastructure.

## Architecture

`dag-core` currently owns both DAG domain contracts (definitions, edges, execution engine) and node authoring infrastructure (base class, lifecycle factories, registries, media reference). These are distinct concerns with different consumers:

- **DAG contracts** — consumed by execution engine, orchestrator, runtime, API
- **Node infrastructure** — consumed by node implementations (`dag-nodes/*`)

Separating them makes each package's SSOT boundary explicit.

## Dependency Direction

```
dag-core (contracts: interfaces, types, error, result, ports, state machines, execution engine)
  ^          ^
  |          |
dag-node     |  (implementations: AbstractNodeDefinition, registries, media reference, schemas)
  ^          |
  |          |
dag-nodes/* -+  (concrete nodes: import infra from dag-node, types from dag-core)
```

- `dag-node` depends on `dag-core` (imports interface types)
- `dag-nodes/*` depends on both `dag-node` and `dag-core`
- `dag-core` does NOT import from `dag-node` (re-exports only for backward compat)
- No circular dependencies

## What Moves to @robota-sdk/dag-node

### Lifecycle implementations

| File | Exports |
|------|---------|
| `lifecycle/abstract-node-definition.ts` | `AbstractNodeDefinition<TSchema>` |
| `lifecycle/node-io-accessor.ts` | `NodeIoAccessor` |
| `lifecycle/registered-node-lifecycle.ts` | `RegisteredNodeLifecycle` |
| `lifecycle/binary-value-parser.ts` | `IParsedBinaryValue`, `parseBinaryValue()` |
| `lifecycle/static-node-lifecycle-factory.ts` | `StaticNodeLifecycleFactory`, `createStaticNodeLifecycleFactory()` |
| `lifecycle/default-node-task-handlers.ts` | `StaticNodeTaskHandlerRegistry` |

### Registry implementations

| File | Exports |
|------|---------|
| `registry/static-node-manifest-registry.ts` | `StaticNodeManifestRegistry` |

### Value objects and schemas

| File | Exports |
|------|---------|
| `value-objects/media-reference.ts` | `MediaReference`, `IMediaReferenceCandidate` |
| `schemas/media-reference-schema.ts` | `MediaReferenceSchema`, `createMediaReferenceConfigSchema()` |

### Utilities

| File | Exports |
|------|---------|
| `utils/node-descriptor.ts` | `buildConfigSchema()` |

### Port definition helpers (extract from `types/domain.ts`)

| Export | Type |
|--------|------|
| `createBinaryPortDefinition()` | function |
| `BINARY_PORT_PRESETS` | const |
| `IBinaryPortDefinitionInput` | interface |
| `IBinaryPortPreset` | interface |

### Corresponding tests

All test files for the above modules move to `dag-node/src/__tests__/`.

## What Stays in @robota-sdk/dag-core

- All interfaces: `INodeLifecycle`, `INodeTaskHandler`, `IDagNodeDefinition`, `INodeManifest`, `IPortDefinition`, `INodeManifestRegistry`, `INodeLifecycleFactory`, etc.
- All core types: `TPortPayload`, `TPortValue`, `IPortBinaryValue`, `IDagError`, `TResult`, `TBinaryKind`, `TPortValueType`, `TAssetReference`, etc.
- Execution engine: `NodeLifecycleRunner`, `LifecycleTaskExecutorPort`
- DAG domain: definitions, edges, state machines, validators, services
- Constants, events, testing adapters

## Backward Compatibility

`dag-core/src/index.ts` adds re-exports for all moved symbols:

```typescript
// Backward compat — owner is @robota-sdk/dag-node
export {
    AbstractNodeDefinition,
    NodeIoAccessor,
    MediaReference,
    // ...
} from '@robota-sdk/dag-node';
```

This follows AGENTS.md rule: "`export type { X } from` is allowed." Consumers outside `dag-nodes/*` (e.g., `dag-runtime-server`, `dag-orchestrator-server`) continue working without immediate import changes.

## SPEC Documents

### New: `packages/dag-node/docs/SPEC.md`

SSOT for node authoring infrastructure:
- `AbstractNodeDefinition` contract and lifecycle hooks
- `NodeIoAccessor` API
- Media reference schema and value object
- Port definition helpers and presets
- Registry implementations (manifest, handler)
- Config schema conversion

### Updated: `packages/dag-core/docs/SPEC.md`

Remove node infrastructure sections. Add reference: "Node authoring infrastructure → `@robota-sdk/dag-node` SPEC."

### Updated: `packages/dag-nodes/docs/SPEC.md`

Update dependency references from `dag-core` to `dag-node` for node infrastructure imports.

## Package Configuration

```json
{
  "name": "@robota-sdk/dag-node",
  "version": "3.0.0",
  "type": "module",
  "dependencies": {
    "@robota-sdk/dag-core": "workspace:*",
    "zod": "^3.24.2",
    "zod-to-json-schema": "^3.24.5"
  }
}
```

## Verification

```bash
pnpm install
pnpm --filter @robota-sdk/dag-node build
pnpm --filter @robota-sdk/dag-node test
pnpm --filter @robota-sdk/dag-core build
pnpm --filter @robota-sdk/dag-core test
pnpm --filter "./packages/dag-nodes/**" build
pnpm --filter "./packages/dag-nodes/**" test
pnpm typecheck
pnpm test
```
