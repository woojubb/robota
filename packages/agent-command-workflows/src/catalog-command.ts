import { resolve } from 'node:path';

import { DEFAULT_WORKSPACE_LAYOUT } from '@robota-sdk/dag-core';
import { scanWorkspaceCatalog } from '@robota-sdk/dag-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

/** Default workspace directory for workflow files (relative to the working directory). FLOW-007. */
const DEFAULT_CATALOG_DIR = DEFAULT_WORKSPACE_LAYOUT.root; // '.workflows'
const WORKFLOW_EXT = DEFAULT_WORKSPACE_LAYOUT.workflowExt; // '.json'

/**
 * `/workflows catalog` — list the workflow definitions flat under the workspace root (default
 * `.workflows/`, `<name>.json`) via the shared `scanWorkspaceCatalog` reader (FLOW-007 C3 — one reader
 * across dag-cli's `catalog` and this command). Node manifests + non-DAG JSON are skipped.
 */
export async function executeWorkflowsCatalog(
  cwd: string,
  dir: string = DEFAULT_CATALOG_DIR,
): Promise<ICommandResult> {
  const entries = await scanWorkspaceCatalog(resolve(cwd, dir), DEFAULT_WORKSPACE_LAYOUT);
  if (entries.length === 0) {
    return { success: true, message: `No workflow files (*${WORKFLOW_EXT}) in ${dir}.` };
  }
  const lines = entries.map((e) => {
    const raw = e.definition as unknown as {
      nodes?: unknown[];
      edges?: unknown[];
      links?: unknown[];
    };
    const nodeCount = raw.nodes?.length ?? 0;
    const linkCount = raw.edges?.length ?? raw.links?.length ?? 0;
    return `  ${e.id}${WORKFLOW_EXT} — ${nodeCount} node(s), ${linkCount} link(s)`;
  });
  return {
    success: true,
    message: `Workflows in ${dir} (${entries.length}):\n${lines.join('\n')}`,
  };
}
