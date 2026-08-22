import { DEFAULT_WORKSPACE_LAYOUT, type IWorkspaceLayout } from '@robota-sdk/dag-core';

import { createWorkspaceRuntime } from './workspace-runtime.js';

import type { ICommandResult } from '@robota-sdk/agent-interface-transport';
import type { IWorkflowProject } from './workflow-project.js';

/**
 * `/workflows list` — list the workflow nodes available to the in-process DAG runtime: the built-in
 * catalog PLUS the instant nodes saved in this workspace under `<root>/nodes/` (WORKFLOW-005 P3),
 * which are marked so the nodes `create`/`build` authored here are distinguishable from built-ins.
 * Composes `dag-framework`'s local provider; no dependency on the `dag-cli` product.
 */
export async function executeWorkflowsList(
  project: IWorkflowProject,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<ICommandResult> {
  const { provider, instantNodes } = await createWorkspaceRuntime(project, layout);
  const saved = new Set(instantNodes.map((n) => n.nodeType));
  const nodes = await provider.listNodes();
  const sorted = [...nodes].sort((a, b) => a.nodeType.localeCompare(b.nodeType));
  const lines = sorted.map((n) => {
    const savedMark = saved.has(n.nodeType) ? ` [saved in ${layout.root}/nodes]` : '';
    return `  ${n.nodeType}${n.description ? ` — ${n.description}` : ''}${savedMark}`;
  });
  const savedLine = saved.size > 0 ? ` (${saved.size} saved in ${layout.root}/nodes)` : '';
  return {
    success: true,
    message: `Available workflow nodes (${nodes.length})${savedLine}:\n${lines.join('\n')}`,
  };
}
