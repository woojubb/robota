# @robota-sdk/dag-node

Node-authoring infrastructure for the DAG engine: the `AbstractNodeDefinition` base class, the
`defineDagNode()` factory, typed input/output access, lifecycle wrappers, registries, media-reference
value objects and port helpers. Concrete node types are built on it.

Internal package: private to this monorepo (`"private": true`) and not published to npm. It is part of
the DAG workflow subsystem; see [the DAG packages](../dag-core/README.md#the-dag-packages).

## Where it sits

- Depends on: [`@robota-sdk/dag-core`](../dag-core/README.md) (the `IDagNodeDefinition` contract it
  implements) and `zod` for config schemas.
- Used by: every `@robota-sdk/dag-node-*` node package under [`packages/dag-nodes/`](../dag-nodes/README.md),
  the default catalog [`dag-nodes-default`](../dag-nodes-default/docs/README.md),
  [`dag-framework`](../dag-framework/README.md) and
  [`@robota-sdk/agent-command-workflows`](../agent-command-workflows/README.md).

## Main exports

- `AbstractNodeDefinition` — base class for a node type. Subclasses declare `nodeType`,
  `displayName`, `category`, `inputs`, `outputs` and a Zod `configSchemaDefinition`, and implement
  `estimateCostWithConfig` and `executeWithConfig`; other lifecycle steps are optional overrides.
  Config is parsed against the schema before any of these methods runs.
- `defineDagNode(options)` — builds a node class from a plain object (`nodeType`, `inputs`,
  `outputs`, `execute`, and optional `configSchema` and `estimateCreditCost`) without subclassing.
- `NodeIoAccessor` — typed input reading (`requireInputString`, `requireInputBinary`, …) and output
  assembly (`setOutput`, `toOutput`) inside a node.
- `buildNodeDefinitionAssembly(nodes)` — turns node definitions into `INodeManifest[]` plus task
  handlers keyed by node type.
- `StaticNodeManifestRegistry`, `StaticNodeTaskHandlerRegistry`, `StaticNodeLifecycleFactory`,
  `RegisteredNodeLifecycle` — registries and lifecycle wrappers used when composing an executor.
- `MediaReference`, `MediaReferenceSchema`, `parseBinaryValue`, `createBinaryPortDefinition`,
  `BINARY_PORT_PRESETS`, `normalizeProviderMediaOutput` — media and binary-port helpers.

## Usage

```ts
import { buildNodeDefinitionAssembly, defineDagNode } from '@robota-sdk/dag-node';

const UpperCaseNode = defineDagNode({
  nodeType: 'upper-case',
  inputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
  outputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
  execute: async ({ text }) => ({ text: String(text).toUpperCase() }),
});

// Turn node definitions into catalog manifests plus task handlers keyed by node type.
const assembly = buildNodeDefinitionAssembly([new UpperCaseNode()]);
if (assembly.ok) {
  console.log(assembly.value.manifests[0]?.defaultInputPort); // 'text'
}
```

A node class like this can be passed to `createDagFramework({ nodes })` from
[`@robota-sdk/dag-framework`](../dag-framework/README.md). For a node written as an
`AbstractNodeDefinition` subclass, see any package under `packages/dag-nodes/`, such as
[`text-output`](../dag-nodes/text-output/src/index.ts).

## Documentation

- [docs/README.md](docs/README.md) — overview of this package's docs.
- [docs/SPEC.md](docs/SPEC.md) — purpose, non-goals, design decisions, extension points and
  invariants.
