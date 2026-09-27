# Default DAG Node Catalog

The default set of DAG node definitions, assembled from the `@robota-sdk/dag-node-*` packages. It is
a composition aggregator: import it at an application entry point or composition root.

Internal package: `@robota-sdk/dag-nodes-default` is private to this monorepo (`"private": true`) and
not published to npm. It is part of the DAG workflow subsystem; see
[the DAG packages](../../dag-core/README.md#the-dag-packages).

## Where it sits

- Depends on: [`@robota-sdk/dag-core`](../../dag-core/docs/README.md),
  [`@robota-sdk/dag-node`](../../dag-node/docs/README.md), the `@robota-sdk/dag-node-*` packages it
  collects (see [DAG node packages](../../dag-nodes/README.md)), and `@robota-sdk/agent-core`,
  `@robota-sdk/agent-framework` and `@robota-sdk/agent-interface-command` for provider and skill
  wiring. `@robota-sdk/agent-builtin-providers` is an optional dependency.
- Used by: [`@robota-sdk/agent-command-workflows`](../../agent-command-workflows/README.md) (the
  `/workflows` catalog) and, lazily, [`dag-framework`](../../dag-framework/docs/README.md) when a
  caller does not pass its own `nodes`. The dependency is one-way: this package never imports
  `dag-framework`.

## Main exports

- `createDefaultNodeRegistrySync()` — returns the base node set: nodes with no optional
  provider-SDK dependency, such as `input`, `transform`, `text-template`, `text-output`, the
  in-process `tool` node and the utility text/data nodes. It always succeeds. This is the set the
  CLI's `/workflows` command uses.
- `createDefaultNodeRegistry(providers?, …)` — async. Adds the `llm-text` node, bound to the
  provider definitions you pass or, when omitted, to a default set loaded lazily from
  `@robota-sdk/agent-builtin-providers` (a load failure throws an error naming that package).
  It also tries to load the optional media nodes (image generation and editing, video) and the
  skill node, and skips any of them whose import or construction fails. Skill files are found only
  through the contribution sources and skill roots the caller passes. This catalog is not part of
  the CLI.

To use a custom catalog instead, pass your own node definitions to `createDagFramework({ nodes })`
and skip this package.

## Usage

```ts
import { createDagFramework } from '@robota-sdk/dag-framework';
import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';

const nodes = createDefaultNodeRegistrySync();
console.log(nodes.map((node) => node.nodeType)); // ['input', 'multi-input', 'transform', ...]

const framework = await createDagFramework({
  nodes,
  paths: { storageRoot: '/var/lib/my-app/dag-storage', assetRoot: '/var/lib/my-app/dag-assets' },
});
await framework.stop();
```

## Documents

- [SPEC.md](SPEC.md) — purpose, contract, non-goals and design decisions of the default catalog.
