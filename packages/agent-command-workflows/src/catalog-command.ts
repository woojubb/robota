import { resolve } from 'node:path';

import { DEFAULT_WORKSPACE_LAYOUT, type IWorkspaceLayout } from '@robota-sdk/dag-core';
import { scanWorkspaceCatalog } from '@robota-sdk/dag-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

/**
 * `/workflows catalog` — list the workflow definitions flat under the injected workspace root (default
 * `.workflows/`, `<name>.json`) via the shared `scanWorkspaceCatalog` reader (FLOW-007 C3 — one reader
 * across dag-cli's `catalog` and this command). Node manifests + non-DAG JSON are skipped.
 */
export async function executeWorkflowsCatalog(
  cwd: string,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<ICommandResult> {
  const dir = layout.root;
  const ext = layout.workflowExt;
  const entries = await scanWorkspaceCatalog(resolve(cwd, dir), layout);
  if (entries.length === 0) {
    return { success: true, message: `No workflow files (*${ext}) in ${dir}.` };
  }
  const lines = entries.map((e) => {
    const raw = e.definition as unknown as {
      nodes?: unknown[];
      edges?: unknown[];
      links?: unknown[];
    };
    const nodeCount = raw.nodes?.length ?? 0;
    const linkCount = raw.edges?.length ?? raw.links?.length ?? 0;
    return `  ${e.id}${ext} — ${nodeCount} node(s), ${linkCount} link(s)`;
  });
  return {
    success: true,
    message: `Workflows in ${dir} (${entries.length}):\n${lines.join('\n')}`,
  };
}
