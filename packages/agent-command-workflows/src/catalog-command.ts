import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { IDagWorkflowFile } from '@robota-sdk/dag-core';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

/** Default local catalog directory for workflow files (relative to the working directory). */
const DEFAULT_CATALOG_DIR = '.dag/workflows';

/**
 * `/workflows catalog` — list the workflow files in the local catalog directory
 * (`.dag/workflows`). A pure filesystem scan over `*.dag.json` files; no dependency on the
 * `dag-cli` product.
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

  const files = entries.filter((name) => name.endsWith('.dag.json')).sort();
  if (files.length === 0) {
    return { success: true, message: `No workflow files (*.dag.json) in ${dir}.` };
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
