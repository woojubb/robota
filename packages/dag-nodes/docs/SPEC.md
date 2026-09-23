# DAG Nodes Specification

## Scope

- Node package layout and node definition delivery conventions.
- Per-node packages export `IDagNodeDefinition` implementations.
- Node packages depend on `dag-core`/`dag-node`; several also consume the `agent-*` subsystem
  one-way — `agent-core` (definition contracts and factories for LLM/media/instant-node families),
  while concrete `agent-provider-*` SDKs are owned by composition roots,
  `agent-tools` (tool node), and `agent-framework`/`agent-interface-transport` (skill node). This
  DAG→agent dependency is one-directional; no `agent-*` package depends back on any DAG package.

## Naming

- Folder: `packages/dag-nodes/<slug>`
- Package: `@robota-sdk/dag-node-<slug>`

## Class Contract Registry

### Inheritance Chains

There is no shared `packages/dag-nodes/src/`. Each node ships as its own package at
`packages/dag-nodes/<slug>` (published as `@robota-sdk/dag-node-<slug>`), with its source under
`<slug>/src/`. All node definitions extend `AbstractNodeDefinition` from `@robota-sdk/dag-node`
(previously in `dag-core`).

Across the 19 child packages there are 34 `*NodeDefinition` classes; a single package may export
several (e.g. `utility-text`, `instant-node`, `gemini-image-edit`). The table below is a
representative subset — each node package documents its own definitions in its `docs/SPEC.md`:

| Base (Owner)                        | Derived                            | Location                 |
| ----------------------------------- | ---------------------------------- | ------------------------ |
| `AbstractNodeDefinition` (dag-node) | `ImageLoaderNodeDefinition`        | `image-loader/src/`      |
| `AbstractNodeDefinition` (dag-node) | `ImageSourceNodeDefinition`        | `image-source/src/`      |
| `AbstractNodeDefinition` (dag-node) | `InputNodeDefinition`              | `input/src/`             |
| `AbstractNodeDefinition` (dag-node) | `TextOutputNodeDefinition`         | `text-output/src/`       |
| `AbstractNodeDefinition` (dag-node) | `TextTemplateNodeDefinition`       | `text-template/src/`     |
| `AbstractNodeDefinition` (dag-node) | `TransformNodeDefinition`          | `transform/src/`         |
| `AbstractNodeDefinition` (dag-node) | `LlmTextNodeDefinition`            | `llm-text/src/`          |
| `AbstractNodeDefinition` (dag-node) | `OkEmitterNodeDefinition`          | `ok-emitter/src/`        |
| `AbstractNodeDefinition` (dag-node) | `GeminiImageEditNodeDefinition`    | `gemini-image-edit/src/` |
| `AbstractNodeDefinition` (dag-node) | `GeminiImageComposeNodeDefinition` | `gemini-image-edit/src/` |
| `AbstractNodeDefinition` (dag-node) | `SeedanceVideoNodeDefinition`      | `seedance-video/src/`    |

### Static registration identity ownership

This table is the authoritative map from each static `nodeType` to the package that exports its
definition. Update it when a definition is added, removed, or moved. No automated
registration-owner scan currently verifies the table; source and contract review keep it in sync.
The default registry chooses which definitions to assemble; it does not own their identities.
Optional definitions and definitions absent from the default catalog remain owned by their leaf
package. One package may own several identities when those definitions are intentionally installed
and released together, as with `utility-text` and `gemini-image-edit`.

<!-- dag-node-registration-owner-map:start -->

| Package owner       | Static `nodeType` identities                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `file-read`         | `file-read`                                                                                                                                                                                                                    |
| `file-write`        | `file-write`                                                                                                                                                                                                                   |
| `gemini-image-edit` | `gemini-image-edit`, `gemini-image-compose`                                                                                                                                                                                    |
| `http-request`      | `http-request`                                                                                                                                                                                                                 |
| `image-loader`      | `image-loader`                                                                                                                                                                                                                 |
| `image-source`      | `image-source`                                                                                                                                                                                                                 |
| `input`             | `input`                                                                                                                                                                                                                        |
| `llm-text`          | `llm-text`                                                                                                                                                                                                                     |
| `multi-input`       | `multi-input`                                                                                                                                                                                                                  |
| `ok-emitter`        | `ok-emitter`                                                                                                                                                                                                                   |
| `seedance-video`    | `seedance-video`                                                                                                                                                                                                               |
| `skill`             | `skill`                                                                                                                                                                                                                        |
| `text-output`       | `text-output`                                                                                                                                                                                                                  |
| `text-template`     | `text-template`                                                                                                                                                                                                                |
| `text-to-image`     | `text-to-image`                                                                                                                                                                                                                |
| `tool`              | `tool`                                                                                                                                                                                                                         |
| `transform`         | `transform`                                                                                                                                                                                                                    |
| `utility-text`      | `string-to-number`, `number-to-string`, `text-join`, `text-split`, `text-replace`, `text-length`, `text-upper`, `text-lower`, `text-trim`, `json-extract`, `conditional-text`, `text-count-lines`, `text-repeat`, `text-slice` |

<!-- dag-node-registration-owner-map:end -->

`instant-node` owns `PromptBackedNodeDefinition` and `CompositeInstantNodeDefinition`, whose
`nodeType` strings are supplied by callers at runtime. Those arbitrary identities cannot be
enumerated in this static map; the factory package owns validation and persistence of them.

### Cross-Package Port Consumers

| Port (Owner)                        | Consumer                | Notes                                                            |
| ----------------------------------- | ----------------------- | ---------------------------------------------------------------- |
| `AbstractNodeDefinition` (dag-node) | All 34 node definitions | Each implements `executeWithConfig` and `estimateCostWithConfig` |
| `NodeIoAccessor` (dag-node)         | All 34 node definitions | Used for input reading and output assembly                       |

### Provider Composition

`dag-node-*` packages are provider-neutral leaves. LLM nodes receive an injected
`IProviderDefinition[]`; media nodes receive an injected `IMediaProviderDefinition`. Definitions,
not provider instances, are passed to nodes so credentials and model capability configuration are
resolved at execution time. Concrete `agent-provider-*` SDK dependencies belong to a composition
aggregator such as `agent-builtin-providers`, never to a DAG node package. Keep concrete provider SDK
dependencies at the composition layer.
