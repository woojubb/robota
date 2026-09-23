# DAG Nodes Specification

## Purpose

Umbrella contract for the `packages/dag-nodes/<slug>` family. Each node ships as its own package
(published as `@robota-sdk/dag-node-<slug>`), exporting `IDagNodeDefinition` implementations. There
is no shared `packages/dag-nodes/src/`; each leaf package documents its own node definitions in its
own `docs/SPEC.md`.

## Contract

- All node definitions extend `AbstractNodeDefinition` from `@robota-sdk/dag-node`.
- Node packages depend on `dag-core`/`dag-node`; several also consume the `agent-*` subsystem
  one-way — `agent-core` for definition contracts and factories for LLM/media/instant-node
  families, `agent-tools` for the tool node, `agent-framework`/`agent-interface-transport` for the
  skill node. This DAG→agent dependency is one-directional: no `agent-*` package depends back on any
  DAG package.
- `dag-node-*` packages are provider-neutral leaves. LLM nodes receive an injected
  `IProviderDefinition[]`; media nodes receive an injected `IMediaProviderDefinition`. Definitions,
  not provider instances, are passed to nodes so credentials and model capability configuration are
  resolved at execution time.

## Non-goals

- Concrete `agent-provider-*` SDK dependencies belong to a composition aggregator such as
  `agent-builtin-providers`, never to a DAG node package.
- Node packages that accept caller-supplied `nodeType` strings at runtime (e.g. `instant-node`'s
  prompt-backed definitions) do not register a static identity here; the factory package owns
  validation and persistence of those identities.
