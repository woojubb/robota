/**
 * Deterministically assembles an `IDagDefinition` from a validated authoring spec, reusing
 * `dag-builder`'s pipeline builder (shared, exported machinery — never dag-cli's private copy).
 */
import type { IDagDefinition, INodeManifest } from '@robota-sdk/dag-core';
import { buildDagFromPipeline, type IPipelineNodeSpec } from '@robota-sdk/dag-builder';
import type { IAuthoredWorkflowSpec } from './spec.js';

export type TAssembleResult =
  | { readonly ok: true; readonly definition: IDagDefinition }
  | { readonly ok: false; readonly error: string };

/**
 * Assemble the DAG. `manifests` must already include any authored prompt nodes (Phase 3) so their
 * ports resolve. Unknown node types produce a structured error (no partial/broken workflow).
 */
export function assembleWorkflow(
  spec: IAuthoredWorkflowSpec,
  manifests: INodeManifest[],
): TAssembleResult {
  const pipeline: IPipelineNodeSpec[] = spec.pipeline.map((step) =>
    step.config ? { nodeType: step.nodeType, config: step.config } : { nodeType: step.nodeType },
  );

  const result = buildDagFromPipeline({ dagId: spec.name, pipeline }, manifests);
  if (!result.ok) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, definition: result.definition };
}
