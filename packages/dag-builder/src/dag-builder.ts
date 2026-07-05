import type {
  IDagDefinition,
  IDagEdgeDefinition,
  IDagError,
  IDagNode,
  IErrorFix,
  INodeConfigObject,
  INodeManifest,
} from '@robota-sdk/dag-core';
import { buildValidationError } from '@robota-sdk/dag-core';

export interface IPipelineNodeSpec {
  readonly nodeType: string;
  readonly id?: string;
  readonly config?: Record<string, unknown>;
  /** Explicit override for the output port used when wiring to the next stage. */
  readonly fromPort?: string;
  /** Explicit override for the input port used when receiving from the previous stage. */
  readonly toPort?: string;
}

export interface IParallelSpec {
  readonly parallel: readonly IPipelineNodeSpec[];
  /** Explicit output port override for parallel branches (one value applies to all). */
  readonly fromPort?: string;
}

export type TPipelineStage = IPipelineNodeSpec | IParallelSpec;

export interface IDagBuildInput {
  readonly dagId?: string;
  readonly pipeline: readonly TPipelineStage[];
}

export interface IDagBuildWarning {
  readonly message: string;
}

export type TDagBuildResult =
  | {
      readonly ok: true;
      readonly definition: IDagDefinition;
      readonly warnings: IDagBuildWarning[];
      readonly nodeCount: number;
      readonly edgeCount: number;
    }
  | {
      readonly ok: false;
      readonly error: IDagError;
      readonly warnings: IDagBuildWarning[];
    };

function isParallelSpec(stage: TPipelineStage): stage is IParallelSpec {
  return 'parallel' in stage;
}

function resolveId(spec: IPipelineNodeSpec, index: number): string {
  return spec.id ?? `${spec.nodeType}-${index}`;
}

function findManifest(manifests: INodeManifest[], nodeType: string): INodeManifest | undefined {
  return manifests.find((m) => m.nodeType === nodeType);
}

function unknownNodeTypeError(nodeType: string, manifests: INodeManifest[]): IDagError {
  const options = manifests.map((m) => m.nodeType);
  const fix: IErrorFix = {
    action: 'replace_node_type',
    suggestion: options[0],
    options,
  };
  return buildValidationError(
    'UNKNOWN_NODE_TYPE',
    `Node type "${nodeType}" is not registered`,
    { requestedType: nodeType },
    fix,
  );
}

/**
 * Build an IDagDefinition from a declarative pipeline spec.
 * Sequential stages are auto-wired using defaultOutputPort → defaultInputPort.
 * Parallel stages fan out from the previous stage and fan back into the next.
 */
export function buildDagFromPipeline(
  input: IDagBuildInput,
  manifests: INodeManifest[],
): TDagBuildResult {
  const warnings: IDagBuildWarning[] = [];
  const nodes: IDagNode[] = [];
  const edges: IDagEdgeDefinition[] = [];

  // Track the "exit" node ids and their output ports from the previous stage.
  // On first iteration this is empty (no previous stage).
  let prevExits: Array<{ nodeId: string; portKey: string }> = [];

  let nodeIndex = 0;

  for (const stage of input.pipeline) {
    if (isParallelSpec(stage)) {
      // Fan out from all previous exits to each parallel branch
      const branchEntries: Array<{ nodeId: string; portKey: string }> = [];

      for (const branchSpec of stage.parallel) {
        const id = resolveId(branchSpec, nodeIndex);
        nodeIndex += 1;

        const manifest = findManifest(manifests, branchSpec.nodeType);
        if (!manifest) {
          return {
            ok: false,
            error: unknownNodeTypeError(branchSpec.nodeType, manifests),
            warnings,
          };
        }

        const dependsOn = prevExits.map((e) => e.nodeId);
        nodes.push({
          nodeId: id,
          nodeType: branchSpec.nodeType,
          dependsOn,
          config: (branchSpec.config ?? {}) as unknown as INodeConfigObject,
        });

        // Wire edges from each previous exit to this branch node
        for (const prev of prevExits) {
          const toPort = branchSpec.toPort ?? manifest.defaultInputPort;
          if (!toPort) {
            warnings.push({
              message: `Node "${id}" (${branchSpec.nodeType}) has no defaultInputPort; edge from "${prev.nodeId}" requires explicit toPort`,
            });
            continue;
          }
          edges.push({
            from: prev.nodeId,
            to: id,
            bindings: [{ outputKey: prev.portKey, inputKey: toPort }],
          });
        }

        // Determine exit port for this branch
        const fromPort = stage.fromPort ?? branchSpec.fromPort ?? manifest.defaultOutputPort;
        if (fromPort) {
          branchEntries.push({ nodeId: id, portKey: fromPort });
        } else {
          warnings.push({
            message: `Node "${id}" (${branchSpec.nodeType}) has no defaultOutputPort; downstream connections require explicit fromPort`,
          });
        }
      }

      prevExits = branchEntries;
    } else {
      // Sequential node
      const id = resolveId(stage, nodeIndex);
      nodeIndex += 1;

      const manifest = findManifest(manifests, stage.nodeType);
      if (!manifest) {
        return {
          ok: false,
          error: unknownNodeTypeError(stage.nodeType, manifests),
          warnings,
        };
      }

      const dependsOn = prevExits.map((e) => e.nodeId);
      nodes.push({
        nodeId: id,
        nodeType: stage.nodeType,
        dependsOn,
        config: (stage.config ?? {}) as unknown as INodeConfigObject,
      });

      // Wire edges from each previous exit to this node
      for (const prev of prevExits) {
        const toPort = stage.toPort ?? manifest.defaultInputPort;
        if (!toPort) {
          warnings.push({
            message: `Node "${id}" (${stage.nodeType}) has no defaultInputPort; edge from "${prev.nodeId}" requires explicit toPort`,
          });
          continue;
        }
        edges.push({
          from: prev.nodeId,
          to: id,
          bindings: [{ outputKey: prev.portKey, inputKey: toPort }],
        });
      }

      // Determine exit port for this node
      const fromPort = stage.fromPort ?? manifest.defaultOutputPort;
      if (fromPort) {
        prevExits = [{ nodeId: id, portKey: fromPort }];
      } else {
        prevExits = [];
      }
    }
  }

  if (nodes.length === 0) {
    return {
      ok: false,
      error: buildValidationError(
        'EMPTY_PIPELINE',
        'pipeline must contain at least one node',
        undefined,
        { action: 'add_node', suggestion: 'Add at least one node spec to the pipeline array' },
      ),
      warnings,
    };
  }

  const dagId = input.dagId ?? 'dag-build-result';
  const definition: IDagDefinition = {
    dagId,
    version: 1,
    status: 'draft',
    nodes,
    edges,
  };

  return {
    ok: true,
    definition,
    warnings,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };
}
