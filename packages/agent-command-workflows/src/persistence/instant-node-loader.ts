/**
 * Reloads prompt-backed nodes previously saved under `<root>/nodes/*.node.json` so authored workflows
 * that reference them can run, and so a later `create` can reuse them. Parsing + reconstruction are
 * owned by `@robota-sdk/dag-node-instant-node` (DATA-003) — this module only walks the directory.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DEFAULT_WORKSPACE_LAYOUT, type IWorkspaceLayout } from '@robota-sdk/dag-core';
import type { IDagNodeDefinition } from '@robota-sdk/dag-core';
import { parsePersistedInstantNode, rehydrateInstantNode } from '@robota-sdk/dag-node-instant-node';

const NODE_MANIFEST_EXT = '.node.json';

/**
 * Load all reloadable instant nodes from `<cwd>/<root>/nodes/`. Missing dir → empty list;
 * unparseable manifests are skipped. Composite nodes need a behavioral sub-runner this package does
 * not build, so they are surfaced as an explicit skip (never silently dropped) — but
 * `saveInstantNodeFile` refuses to write composites, so a composite manifest should never appear here.
 */
export async function loadInstantNodes(
  cwd: string,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<IDagNodeDefinition[]> {
  const dir = resolve(cwd, join(layout.root, 'nodes'));
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    // allow-fallback: nodes dir may not exist yet → no local nodes
    return [];
  }
  const nodes: IDagNodeDefinition[] = [];
  for (const file of files.filter((f) => f.endsWith(NODE_MANIFEST_EXT))) {
    let record: ReturnType<typeof parsePersistedInstantNode>;
    try {
      record = parsePersistedInstantNode(JSON.parse(await readFile(join(dir, file), 'utf-8')));
    } catch {
      // allow-fallback: unreadable/unparseable manifest skipped
      continue;
    }
    if (!record) continue;
    if (record.kind === 'composite') {
      process.stderr.write(
        `[instant-node-loader] skipping composite node "${record.nodeType}" — composite reload is not supported in this workspace\n`,
      );
      continue;
    }
    nodes.push(rehydrateInstantNode(record));
  }
  return nodes;
}
