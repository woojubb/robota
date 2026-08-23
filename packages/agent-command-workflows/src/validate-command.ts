import { dagDefinitionFromParsedFile } from '@robota-sdk/dag-builder';
import { DEFAULT_WORKSPACE_LAYOUT, type IWorkspaceLayout } from '@robota-sdk/dag-core';

import { parseFileArg } from './args.js';
import { createWorkspaceRuntime } from './workspace-runtime.js';
import { assertWorkflowProject } from './workflow-project.js';

import type { IDagDefinition } from '@robota-sdk/dag-core';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';
import type { IWorkflowProject } from './workflow-project.js';

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
  project: IWorkflowProject,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<ICommandResult> {
  const parsedArgs = parseFileArg(argStr, 'validate');
  if (!parsedArgs.ok) {
    return { success: false, message: parsedArgs.error };
  }
  const filePath = parsedArgs.value;

  // The read/parse error is surfaced as a failed command result, not silently swallowed.
  let parsed: unknown;
  try {
    const raw = assertWorkflowProject(project).readText(filePath, 'validate workflow definition');
    if (raw === undefined) throw new Error('workflow file was not found');
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    parsed = new Error(`Failed to read DAG file "${filePath}": ${detail}`);
  }
  if (parsed instanceof Error) {
    return { success: false, message: parsed.message };
  }

  // DAG-002: through the shared import adapter, so the surface whose entire job is answering "is
  // this file valid?" reports an unrecognised shape AND a status outside `TDagDefinitionStatus`
  // rather than passing either through as if the file were fine.
  let definition: IDagDefinition;
  try {
    definition = dagDefinitionFromParsedFile(parsed);
  } catch (err) {
    return {
      success: false,
      message: `"${filePath}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const { provider } = await createWorkspaceRuntime(project, layout);
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
