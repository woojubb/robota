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

| Export                               | Signature                                                                                 | Purpose                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `buildDagFromPipeline`               | `(input, manifests)`                                                                      | Main builder: a pipeline spec plus node manifests → `IDagDefinition`                                                           |
| `dagDefinitionFromParsedFile`        | `(parsed, companion?)`                                                                    | Import adapter: parsed JSON in either on-disk format → `IDagDefinition`                                                        |
| `toDagWorkflowFile`                  | `(definition)`                                                                            | Export a definition to the `.dag.json` workflow-file format                                                                    |
| `fromDagWorkflowFile`                | `(file, companion?)`                                                                      | Parse a `.dag.json` workflow file back to `IDagDefinition`                                                                     |
| `toWorkflowNodeType`                 | `(nodeType)`                                                                              | Domain node type → workflow-file node type string                                                                              |
| `fromWorkflowNodeType`               | `(nodeType)`                                                                              | Workflow-file node type string → domain node type                                                                              |
| `isWorkflowFileFormat`               | `(obj)`                                                                                   | Format guard: parsed JSON is a workflow file                                                                                   |
| `isLegacyDefinitionFormat`           | `(obj)`                                                                                   | Format guard: parsed JSON is an `IDagDefinition`                                                                               |
| `DAG_BUILDER_PACKAGE_NAME`           | `string`                                                                                  | This package's name, for diagnostics that must not hardcode it                                                                 |
| `decodeDagFile`                      | `(parsed: unknown, companion?: IDagRobotaCompanion) => TResult<…, IDagFileDecodeFailure>` | Total decode of either on-disk format (workflow file or definition); never throws, never casts                                 |
| `formatDagFileDecodeFailure`         | `(failure: IDagFileDecodeFailure) => string`                                              | Render a decode failure as one operator-facing line, naming the format it was recognised as                                    |
| `DagFileDecodeError`                 | `class extends Error`                                                                     | Thrown by `dagDefinitionFromParsedFile`; carries the `IDagFileDecodeFailure` for callers that render it                        |
| `DAG_DEFINITION_FILE_DECODE_OPTIONS` | `IDagDefinitionDecodeOptions`                                                             | The file-boundary allowances: a definition FILE may predate `status` (→ `draft`) and `edges` (→ `[]`); absent is not malformed |
| `IDagFileDecodeFailure`              | `interface`                                                                               | `{ format: TDagFileFormat \| 'unrecognised', issues: IDagDecodeIssue[] }` — why a parsed value is not a DAG file               |
| `TDagFileFormat`                     | `type`                                                                                    | `'workflow-file' \| 'definition'` — which on-disk format a parsed value was recognised as                                      |

`dagDefinitionFromParsedFile` is where the workflow-file format SHOULD be read, and where the
surfaces converted so far do read it — `/workflows run`, `/workflows validate` and `dag runs submit`.
Eight `dag-cli` commands still open-code the same branch and pass a definition through unchecked;
that sweep is DAG-004. Do not read this as coverage it does not yet have. Since DAG-002 the
execution contract is the domain model (`IDagRuntimeProvider.execute` takes an `IDagDefinition`), so
import at the edge is the only job the file format has. It is pure and synchronous: a caller that
also reads a `.dag.robota.json` companion off disk does that IO itself and passes the result in — the
companion carries what the format cannot (original node ids, retry and cost policies), and without it
an imported workflow's nodes are named `node-<n>` because that is genuinely all the file records.

## Extension Points

- Callers supply their own `INodeManifest[]` to control which node types are valid.
- `IPipelineNodeSpec.fromPort` and `toPort` override auto-wired port names per stage.
- `IParallelSpec.fromPort` overrides the shared exit port for all parallel branches.
