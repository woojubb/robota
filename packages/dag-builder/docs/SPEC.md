# DAG Builder Specification

## Scope

- Owns declarative pipeline-to-`IDagDefinition` construction and `.dag.json` workflow file conversion.
- Provides a typed builder API that converts a linear/parallel pipeline spec into a fully wired `IDagDefinition` without manual edge authoring.

## Boundaries

- Depends only on `@robota-sdk/dag-core` for shared types and error builders.
- Does not execute DAGs — construction only.
- Does not own node manifests; manifests are passed in by the caller.

## Architecture Overview

- `buildDagFromPipeline(input, manifests)` — takes an `IDagBuildInput` (pipeline stages) and a list of `INodeManifest[]`, auto-wires edges using `defaultOutputPort` → `defaultInputPort`, and returns a `TDagBuildResult`.
- Sequential stages are connected in order; parallel stages fan out from and fan back into sequential nodes.
- `toDagWorkflowFile` / `fromDagWorkflowFile` — bidirectional conversion between `IDagDefinition` and the `.dag.json` workflow file format.
- `toWorkflowNodeType` / `fromWorkflowNodeType` — node type string normalisation helpers.

## Type Ownership

| Type                    | Location                        | Purpose                                      |
| ----------------------- | ------------------------------- | -------------------------------------------- |
| `IDagBuildInput`        | `src/dag-builder.ts`            | Input: dagId + pipeline stages               |
| `IPipelineNodeSpec`     | `src/dag-builder.ts`            | Single sequential node spec                  |
| `IParallelSpec`         | `src/dag-builder.ts`            | Parallel branch group spec                   |
| `TPipelineStage`        | `src/dag-builder.ts`            | Union of sequential and parallel stage types |
| `IDagBuildWarning`      | `src/dag-builder.ts`            | Non-fatal build warning                      |
| `TDagBuildResult`       | `src/dag-builder.ts`            | Success (definition + stats) or failure      |
| `IToWorkflowFileResult` | `src/dag-workflow-converter.ts` | Result of `toDagWorkflowFile`                |

## Public API Surface

- `buildDagFromPipeline(input, manifests)` — main builder function
- `toDagWorkflowFile(definition)` — convert to `.dag.json` format
- `fromDagWorkflowFile(file)` — parse `.dag.json` back to `IDagDefinition`
- `toWorkflowNodeType(nodeType)` / `fromWorkflowNodeType(nodeType)` — node type string helpers
- `isWorkflowFileFormat(obj)` / `isLegacyDefinitionFormat(obj)` — format detection guards

## Extension Points

- Callers supply their own `INodeManifest[]` to control which node types are valid.
- `IPipelineNodeSpec.fromPort` and `toPort` override auto-wired port names per stage.
- `IParallelSpec.fromPort` overrides the shared exit port for all parallel branches.
