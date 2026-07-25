import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  fromDagWorkflowFile,
  isLegacyDefinitionFormat,
  isWorkflowFileFormat,
} from '@robota-sdk/dag-builder';
import { DEFAULT_WORKSPACE_LAYOUT, type IWorkspaceLayout } from '@robota-sdk/dag-core';

import { parseFileArg } from './args.js';
import { createWorkspaceRuntime } from './workspace-runtime.js';

import type { IDagDefinition } from '@robota-sdk/dag-core';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

/**
 * `/workflows validate <file.json>` — structurally validate a workflow file against the workspace's
 * node catalog: recognized format, known node types, and edges that reference real nodes. The
 * catalog is the SAME one `run` executes against — built-ins plus the instant nodes saved under
 * `<root>/nodes/` (WORKFLOW-005 P3) — so a workflow `build` just authored with a new prompt node
 * validates instead of failing on its own node. Argument parsing shares the `/workflows` grammar
 * (`parseFileArg`). Composes `dag-builder` (format detection + conversion) + `dag-framework` (node
 * catalog); no dependency on the `dag-cli` product.
 */
export async function executeWorkflowsValidate(
  argStr: string,
  cwd: string,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<ICommandResult> {
  const parsedArgs = parseFileArg(argStr, 'validate');
  if (!parsedArgs.ok) {
    return { success: false, message: parsedArgs.error };
  }
  const filePath = parsedArgs.value;

  // The read/parse error is surfaced as a failed command result, not silently swallowed.
  const parsed = await readFile(resolve(cwd, filePath), 'utf-8')
    .then((raw) => JSON.parse(raw) as unknown)
    .catch((err: unknown) => {
      const detail = err instanceof Error ? err.message : String(err);
      return new Error(`Failed to read DAG file "${filePath}": ${detail}`);
    });
  if (parsed instanceof Error) {
    return { success: false, message: parsed.message };
  }

  let definition: IDagDefinition;
  if (isWorkflowFileFormat(parsed)) {
    definition = fromDagWorkflowFile(parsed);
  } else if (isLegacyDefinitionFormat(parsed)) {
    definition = parsed;
  } else {
    return {
      success: false,
      message: `"${filePath}" is not a recognized DAG workflow file (expected a .dag.json node-graph or a DAG definition).`,
    };
  }

  const { provider } = await createWorkspaceRuntime(cwd, layout);
  const manifests = await provider.listNodes();
  const knownTypes = new Set(manifests.map((m) => m.nodeType));
  const nodeIds = new Set(definition.nodes.map((n) => n.nodeId));

  const errors: string[] = [];
  if (definition.nodes.length === 0) {
    errors.push('workflow has no nodes');
  }
  for (const node of definition.nodes) {
    if (!knownTypes.has(node.nodeType)) {
      errors.push(`node "${node.nodeId}": unknown node type "${node.nodeType}"`);
    }
  }
  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`edge references unknown source node "${edge.from}"`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`edge references unknown target node "${edge.to}"`);
    }
  }

  if (errors.length > 0) {
    const plural = errors.length === 1 ? '' : 's';
    return {
      success: false,
      message: `Invalid workflow "${filePath}" (${errors.length} issue${plural}):\n${errors
        .map((e) => `  - ${e}`)
        .join('\n')}`,
    };
  }
  return {
    success: true,
    message: `Valid workflow "${filePath}": ${definition.nodes.length} node(s), ${definition.edges.length} edge(s).`,
  };
}
