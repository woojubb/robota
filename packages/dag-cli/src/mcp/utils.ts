/** Shared utility functions for MCP tool handlers. */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { buildNodeDefinitionAssembly } from '@robota-sdk/dag-node';
import type { IDagDefinition, IDagError, INodeManifest } from '@robota-sdk/dag-core';
import { buildValidationError } from '@robota-sdk/dag-core';
import { createCliNodeRegistry } from '../local-runner/index.js';
import type { ILocalRunResult } from '../local-runner/index.js';

export const JSON_INDENT_SPACES = 2;
export const UTF8_ENCODING = 'utf8' as const;
export const DEFAULT_TIMEOUT_MS = 120_000;

/** Build manifests from a list of node definitions */
export function buildManifests(
  definitions: ReturnType<typeof createCliNodeRegistry>,
): INodeManifest[] {
  const assemblyResult = buildNodeDefinitionAssembly(definitions);
  if (!assemblyResult.ok) {
    throw new Error(`Node definition assembly failed: ${assemblyResult.error.code}`);
  }
  return assemblyResult.value.manifests;
}

export function makeTextResult(payload: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, JSON_INDENT_SPACES) }],
    isError,
  };
}

export function makeErrorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export function resolveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Parse a JSON string or object-typed arg into an object */
export function parseDefinitionArg(
  args: Record<string, unknown>,
  key: string,
):
  | { readonly ok: true; readonly value: IDagDefinition }
  | { readonly ok: false; readonly error: string } {
  const raw = args[key];
  if (raw === null || raw === undefined) {
    return { ok: false, error: `"${key}" is required` };
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { ok: true, value: raw as IDagDefinition };
  }
  return { ok: false, error: `"${key}" must be a JSON object` };
}

/** Safely parse a JSON string; returns undefined if the string is malformed. */
export function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (parseErr) {
    return parseErr instanceof Error ? undefined : undefined;
  }
}

/** Collect outputs from taskRuns outputSnapshot fields */
export function collectOutputs(result: ILocalRunResult): Record<string, unknown> {
  const outputs: Record<string, unknown> = {};
  for (const taskRun of result.taskRuns) {
    if (!taskRun.outputSnapshot) continue;
    const parsed = safeParseJson(taskRun.outputSnapshot);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        outputs[`${taskRun.nodeId}.${k}`] = v;
      }
    }
  }
  return outputs;
}

/** Detect cycles in the DAG using iterative DFS. */
export function detectCycle(nodes: IDagDefinition['nodes']): string[] | null {
  const nodeIds = new Set(nodes.map((n) => n.nodeId));
  const state = new Map<string, number>();
  for (const nodeId of nodeIds) {
    state.set(nodeId, 0);
  }

  const dependsOnMap = new Map<string, string[]>();
  for (const node of nodes) {
    dependsOnMap.set(
      node.nodeId,
      node.dependsOn.filter((dep) => nodeIds.has(dep)),
    );
  }

  for (const startId of nodeIds) {
    if (state.get(startId) === 2) continue;

    const stack: Array<{ nodeId: string; index: number }> = [{ nodeId: startId, index: 0 }];
    const path: string[] = [startId];
    state.set(startId, 1);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const deps = dependsOnMap.get(frame.nodeId) ?? [];

      if (frame.index >= deps.length) {
        state.set(frame.nodeId, 2);
        stack.pop();
        path.pop();
      } else {
        const dep = deps[frame.index];
        frame.index += 1;
        if (dep === undefined) continue;
        const depState = state.get(dep) ?? 0;
        if (depState === 1) {
          const cycleStart = path.indexOf(dep);
          return path.slice(cycleStart);
        }
        if (depState === 0) {
          state.set(dep, 1);
          path.push(dep);
          stack.push({ nodeId: dep, index: 0 });
        }
      }
    }
  }

  return null;
}

/** Run validation checks on a DAG definition. Returns structured errors with agent-recoverable fix hints. */
export function validateDagDefinition(
  dag: IDagDefinition,
  manifests: INodeManifest[],
): IDagError[] {
  const errors: IDagError[] = [];
  const knownTypes = new Set(manifests.map((m) => m.nodeType));
  const nodes = dag.nodes ?? [];
  const edges = dag.edges ?? [];

  // Check 1: Unknown node types
  for (const node of nodes) {
    if (!knownTypes.has(node.nodeType)) {
      errors.push(
        buildValidationError(
          'UNKNOWN_NODE_TYPE',
          `Node type "${node.nodeType}" is not registered`,
          { nodeId: node.nodeId, requestedType: node.nodeType },
          {
            action: 'replace_node_type',
            suggestion: manifests[0]?.nodeType,
            options: manifests.map((m) => m.nodeType),
          },
        ),
      );
    }
  }

  // Check 2: Cycle detection
  if (nodes.length > 0) {
    const cycle = detectCycle(nodes);
    if (cycle !== null) {
      const last = cycle[cycle.length - 1] ?? '';
      const first = cycle[0] ?? '';
      errors.push(
        buildValidationError(
          'CYCLE_DETECTED',
          `Cycle detected in DAG: ${cycle.join(' → ')} → ${first}`,
          { cycle: cycle.join(' → ') },
          { action: 'remove_edge', suggestion: `Remove the edge from "${last}" to "${first}"` },
        ),
      );
    }
  }

  // Check 3: No input node
  const INPUT_NODE_TYPES = ['input', 'multi-input'];
  const hasInputNode = nodes.some((n) => INPUT_NODE_TYPES.includes(n.nodeType));
  if (!hasInputNode) {
    errors.push(
      buildValidationError(
        'MISSING_INPUT_NODE',
        'No input node found (requires at least one node with nodeType "input" or "multi-input")',
        undefined,
        {
          action: 'add_node',
          suggestion: 'Add a node with nodeType "input" or "multi-input" to the pipeline',
        },
      ),
    );
  }

  // Check 4: No output node
  const OUTPUT_NODE_TYPES = ['text-output', 'ok-emitter'];
  const hasOutputNode = nodes.some((n) => OUTPUT_NODE_TYPES.includes(n.nodeType));
  if (!hasOutputNode) {
    errors.push(
      buildValidationError(
        'MISSING_OUTPUT_NODE',
        `No output node found (requires at least one node with nodeType: ${OUTPUT_NODE_TYPES.map((t) => `"${t}"`).join(', ')})`,
        undefined,
        {
          action: 'add_node',
          suggestion: 'Add a node with nodeType "text-output" to the pipeline',
          options: OUTPUT_NODE_TYPES,
        },
      ),
    );
  }

  // Check 5: Unconnected required input ports — only when edges are explicitly defined.
  // DAGs with edges:[] use implicit dependsOn wiring and are exempt from this check.
  for (const node of edges.length > 0 ? nodes : []) {
    if (INPUT_NODE_TYPES.includes(node.nodeType)) continue;
    const manifest = manifests.find((m) => m.nodeType === node.nodeType);
    if (!manifest) continue;
    for (const inputPort of manifest.inputs) {
      if (!inputPort.required) continue;
      const isConnected = edges.some(
        (e) => e.to === node.nodeId && (e.bindings ?? []).some((b) => b.inputKey === inputPort.key),
      );
      if (!isConnected) {
        const potentialSources = nodes
          .filter((n) => n.nodeId !== node.nodeId)
          .flatMap((n) => {
            const nm = manifests.find((m) => m.nodeType === n.nodeType);
            if (!nm) return [];
            return nm.outputs
              .filter((op) => op.type === inputPort.type)
              .map((op) => `${n.nodeId}.${op.key}`);
          });
        errors.push(
          buildValidationError(
            'UNCONNECTED_REQUIRED_PORT',
            `Node "${node.nodeId}" has required input port "${inputPort.key}" (type: ${inputPort.type}) that is not connected`,
            {
              nodeId: node.nodeId,
              nodeType: node.nodeType,
              port: inputPort.key,
              portType: inputPort.type,
            },
            {
              action: 'connect_port',
              suggestion:
                potentialSources[0] !== undefined
                  ? `Connect "${potentialSources[0]}" to "${node.nodeId}.${inputPort.key}"`
                  : `Provide a source node with a "${inputPort.type}" output port`,
              options: potentialSources,
            },
          ),
        );
      }
    }
  }

  // Check 6: Port type mismatches across edges
  for (const edge of edges) {
    const fromNode = nodes.find((n) => n.nodeId === edge.from);
    const toNode = nodes.find((n) => n.nodeId === edge.to);
    if (!fromNode || !toNode) continue;
    const fromManifest = manifests.find((m) => m.nodeType === fromNode.nodeType);
    const toManifest = manifests.find((m) => m.nodeType === toNode.nodeType);
    if (!fromManifest || !toManifest) continue;
    for (const binding of edge.bindings ?? []) {
      const outputPort = fromManifest.outputs.find((p) => p.key === binding.outputKey);
      const inputPort = toManifest.inputs.find((p) => p.key === binding.inputKey);
      if (!outputPort || !inputPort) continue;
      if (outputPort.type !== inputPort.type) {
        errors.push(
          buildValidationError(
            'PORT_TYPE_MISMATCH',
            `Cannot connect "${edge.from}.${binding.outputKey}" (${outputPort.type}) to "${edge.to}.${binding.inputKey}" (${inputPort.type})`,
            {
              sourceNode: edge.from,
              sourcePort: binding.outputKey,
              sourceType: outputPort.type,
              targetNode: edge.to,
              targetPort: binding.inputKey,
              targetType: inputPort.type,
            },
            {
              action: 'fix_port_binding',
              suggestion: `Use a node that converts ${outputPort.type} to ${inputPort.type}, or choose compatible ports`,
            },
          ),
        );
      }
    }
  }

  return errors;
}
