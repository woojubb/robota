# DAG Nodes Specification

## Scope
- Node package layout and node definition delivery conventions.
- Per-node packages export `IDagNodeDefinition` implementations.

## Naming
- Folder: `packages/dag-nodes/<slug>`
- Package: `@robota-sdk/dag-node-<slug>`

## Class Contract Registry

### Inheritance Chains

All node definitions extend `AbstractNodeDefinition` from `dag-core`:

| Base (Owner) | Derived | Location |
|------|---------|----------|
| `AbstractNodeDefinition` (dag-core) | `ImageLoaderNodeDefinition` | `src/image-loader/` |
| `AbstractNodeDefinition` (dag-core) | `ImageSourceNodeDefinition` | `src/image-source/` |
| `AbstractNodeDefinition` (dag-core) | `InputNodeDefinition` | `src/input/` |
| `AbstractNodeDefinition` (dag-core) | `TextOutputNodeDefinition` | `src/text-output/` |
| `AbstractNodeDefinition` (dag-core) | `TextTemplateNodeDefinition` | `src/text-template/` |
| `AbstractNodeDefinition` (dag-core) | `TransformNodeDefinition` | `src/transform/` |
| `AbstractNodeDefinition` (dag-core) | `LlmTextOpenAiNodeDefinition` | `src/llm-text-openai/` |
| `AbstractNodeDefinition` (dag-core) | `OkEmitterNodeDefinition` | `src/ok-emitter/` |
| `AbstractNodeDefinition` (dag-core) | `GeminiImageEditNodeDefinition` | `src/gemini-image-edit/` |
| `AbstractNodeDefinition` (dag-core) | `GeminiImageComposeNodeDefinition` | `src/gemini-image-compose/` |
| `AbstractNodeDefinition` (dag-core) | `SeedanceVideoNodeDefinition` | `src/seedance-video/` |

### Cross-Package Port Consumers

| Port (Owner) | Consumer | Notes |
|--------------|---------|-------|
| `AbstractNodeDefinition` (dag-core) | All 11 node definitions | Each implements `executeWithConfig` and `estimateCostWithConfig` |
| `NodeIoAccessor` (dag-core) | All 11 node definitions | Used for input reading and output assembly |
