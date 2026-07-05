import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { DEFAULT_WORKSPACE_LAYOUT, type IDagWorkflowFile } from '@robota-sdk/dag-core';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

/** Default workspace directory for workflow files (relative to the working directory). FLOW-007. */
const DEFAULT_CATALOG_DIR = DEFAULT_WORKSPACE_LAYOUT.root; // '.workflows'
const WORKFLOW_EXT = DEFAULT_WORKSPACE_LAYOUT.workflowExt; // '.json'
const NODE_MANIFEST_SUFFIX = '.node.json';

/**
 * `/workflows catalog` — list the workflow definition files flat under the workspace root
 * (default `.workflows/`, `<name>.json`). A pure filesystem scan; no dependency on the `dag-cli`
 * product. Node manifests (`.node.json`) that share the root are skipped.
 */
export async function executeWorkflowsCatalog(
  cwd: string,
  dir: string = DEFAULT_CATALOG_DIR,
): Promise<ICommandResult> {
  const catalogDir = resolve(cwd, dir);
  // A missing catalog directory is a normal empty state, not an error.
  const entries = await readdir(catalogDir).catch(() => null);
  if (entries === null) {
    return {
      success: true,
      message: `No workflow catalog at ${dir} (build or save a workflow to populate it).`,
    };
  }

  const files = entries
    .filter((name) => name.endsWith(WORKFLOW_EXT) && !name.endsWith(NODE_MANIFEST_SUFFIX))
    .sort();
  if (files.length === 0) {
    return { success: true, message: `No workflow files (*${WORKFLOW_EXT}) in ${dir}.` };
  }

  const lines: string[] = [];
  for (const file of files) {
    const summary = await readFile(join(catalogDir, file), 'utf-8')
      .then((raw) => JSON.parse(raw) as IDagWorkflowFile)
      .then((wf) => `${wf.nodes?.length ?? 0} node(s), ${wf.links?.length ?? 0} link(s)`)
      .catch(() => 'unreadable');
    lines.push(`  ${file} — ${summary}`);
  }
  return {
    success: true,
    message: `Workflows in ${dir} (${files.length}):\n${lines.join('\n')}`,
  };
}
