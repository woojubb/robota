/**
 * Writes authored workflows and prompt-backed nodes to the workspace, in the exact on-disk formats
 * the shared `scanWorkspaceCatalog` reader (dag-framework) expects: workflow definitions flat at
 * `<root>/<name><ext>`, node manifests at `<root>/nodes/<type>.node.json`. Kept in the agent layer
 * (not dag-framework) so the instant-node dependency doesn't pull agent-* into the dag layer.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DEFAULT_WORKSPACE_LAYOUT, type IWorkspaceLayout } from '@robota-sdk/dag-core';
import type { IDagDefinition, IDagNodeDefinition } from '@robota-sdk/dag-core';
import type { IPersistableInstantNode } from '@robota-sdk/dag-node-instant-node';

const NODE_MANIFEST_EXT = '.node.json';
const JSON_INDENT = 2;

/** Persist a workflow definition to `<cwd>/<root>/<name><ext>`. Returns the absolute written path. */
export async function saveWorkflowFile(
  cwd: string,
  name: string,
  definition: IDagDefinition,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<string> {
  const dir = resolve(cwd, layout.root);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${name}${layout.workflowExt}`);
  await writeFile(path, `${JSON.stringify(definition, null, JSON_INDENT)}\n`, 'utf-8');
  return path;
}

function asPersistable(node: IDagNodeDefinition): IPersistableInstantNode | null {
  const candidate = node as unknown as { toPersisted?: unknown };
  return typeof candidate.toPersisted === 'function'
    ? (node as unknown as IPersistableInstantNode)
    : null;
}

/**
 * Persist a prompt-backed / instant node to `<cwd>/<root>/nodes/<type>.node.json`. Nodes without a
 * `toPersisted()` (built-ins) are skipped and return `null`.
 */
export async function saveInstantNodeFile(
  cwd: string,
  node: IDagNodeDefinition,
  createdAt: string,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<string | null> {
  const persistable = asPersistable(node);
  if (!persistable) return null;
  const dir = resolve(cwd, join(layout.root, 'nodes'));
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${node.nodeType}${NODE_MANIFEST_EXT}`);
  const record = { ...persistable.toPersisted(), createdAt };
  await writeFile(path, `${JSON.stringify(record, null, JSON_INDENT)}\n`, 'utf-8');
  return path;
}
