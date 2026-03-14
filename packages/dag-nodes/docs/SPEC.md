# DAG Nodes Specification

## Scope
- Node package layout and node definition delivery conventions.
- Per-node packages export `IDagNodeDefinition` implementations.

## Naming
- Folder: `packages/dag-nodes/<slug>`
- Package: `@robota-sdk/dag-node-<slug>`

## Class Contract Registry

### Inheritance Chains

All node definitions extend `AbstractNodeDefinition` from `@robota-sdk/dag-node` (previously in `dag-core`):

| Base (Owner) | Derived | Location |
|------|---------|----------|
| `AbstractNodeDefinition` (dag-node) | `ImageLoaderNodeDefinition` | `src/image-loader/` |
| `AbstractNodeDefinition` (dag-node) | `ImageSourceNodeDefinition` | `src/image-source/` |
| `AbstractNodeDefinition` (dag-node) | `InputNodeDefinition` | `src/input/` |
| `AbstractNodeDefinition` (dag-node) | `TextOutputNodeDefinition` | `src/text-output/` |
| `AbstractNodeDefinition` (dag-node) | `TextTemplateNodeDefinition` | `src/text-template/` |
| `AbstractNodeDefinition` (dag-node) | `TransformNodeDefinition` | `src/transform/` |
| `AbstractNodeDefinition` (dag-node) | `LlmTextOpenAiNodeDefinition` | `src/llm-text-openai/` |
| `AbstractNodeDefinition` (dag-node) | `OkEmitterNodeDefinition` | `src/ok-emitter/` |
| `AbstractNodeDefinition` (dag-node) | `GeminiImageEditNodeDefinition` | `src/gemini-image-edit/` |
| `AbstractNodeDefinition` (dag-node) | `GeminiImageComposeNodeDefinition` | `src/gemini-image-compose/` |
| `AbstractNodeDefinition` (dag-node) | `SeedanceVideoNodeDefinition` | `src/seedance-video/` |

### Cross-Package Port Consumers

| Port (Owner) | Consumer | Notes |
|--------------|---------|-------|
| `AbstractNodeDefinition` (dag-node) | All 11 node definitions | Each implements `executeWithConfig` and `estimateCostWithConfig` |
| `NodeIoAccessor` (dag-node) | All 11 node definitions | Used for input reading and output assembly |
