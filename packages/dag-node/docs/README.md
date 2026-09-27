# DAG Node

Node-authoring infrastructure for Robota's DAG engine: the `AbstractNodeDefinition` base class,
`defineDagNode()`, typed IO access, lifecycle wrappers, registries and media value objects.

`@robota-sdk/dag-node` sits between `@robota-sdk/dag-core`, which defines the node contracts, and the
`@robota-sdk/dag-node-*` packages under `packages/dag-nodes/`, which implement concrete node types
on top of it. It holds no concrete nodes and no execution engine. A node's config is validated
against its Zod schema before any node code runs, and fallible operations return typed results.

## Documents

- [SPEC.md](SPEC.md) — purpose, non-goals, design decisions, extension points (base class, IO
  accessor, task handler) and invariants.
- [Package README](../README.md) — main exports and a usage example.
- [DAG node packages](../../dag-nodes/README.md) — the concrete node types built on this package.
