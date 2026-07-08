# DAG Nodes Specification

## Scope

- Node package layout and node definition delivery conventions.
- Per-node packages export `IDagNodeDefinition` implementations.
- Node packages depend on `dag-core`/`dag-node`; several also consume the `agent-*` subsystem
  one-way — `agent-core`/`agent-provider` (LLM-text, image, video, instant-node families),
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

Across the 25 child packages there are 40 `*NodeDefinition` classes; a single package may export
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
| `AbstractNodeDefinition` (dag-node) | `LlmTextOpenAiNodeDefinition`      | `llm-text-openai/src/`   |
| `AbstractNodeDefinition` (dag-node) | `OkEmitterNodeDefinition`          | `ok-emitter/src/`        |
| `AbstractNodeDefinition` (dag-node) | `GeminiImageEditNodeDefinition`    | `gemini-image-edit/src/` |
| `AbstractNodeDefinition` (dag-node) | `GeminiImageComposeNodeDefinition` | `gemini-image-edit/src/` |
| `AbstractNodeDefinition` (dag-node) | `SeedanceVideoNodeDefinition`      | `seedance-video/src/`    |

### Cross-Package Port Consumers

| Port (Owner)                        | Consumer                | Notes                                                            |
| ----------------------------------- | ----------------------- | ---------------------------------------------------------------- |
| `AbstractNodeDefinition` (dag-node) | All 40 node definitions | Each implements `executeWithConfig` and `estimateCostWithConfig` |
| `NodeIoAccessor` (dag-node)         | All 40 node definitions | Used for input reading and output assembly                       |
