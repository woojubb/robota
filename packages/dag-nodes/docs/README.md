# DAG Node Packages

`packages/dag-nodes/` holds the node packages of Robota's DAG workflow engine: one internal package
per node family, named `@robota-sdk/dag-node-<folder>`. The folder itself is not a package. Every
node extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`. Nodes that call an AI provider
receive provider definitions from their composition root instead of importing a provider SDK.

The catalog of node packages, with a link to each node's page, is in [../README.md](../README.md).
[`@robota-sdk/dag-nodes-default`](../../dag-nodes-default/docs/README.md) assembles the default
node set.

## Docs in this folder

- [SPEC.md](SPEC.md) — the contract every node package shares: base class, dependency direction,
  and provider injection.
- [MEDIA-PROVIDER-CONTRACT.md](MEDIA-PROVIDER-CONTRACT.md) — how image and video nodes use injected
  media provider capabilities, and the error codes they map.
