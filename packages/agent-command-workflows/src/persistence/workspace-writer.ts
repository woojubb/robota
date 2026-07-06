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
import { isPersistableInstantNode } from '@robota-sdk/dag-node-instant-node';

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

/**
 * Persist a prompt-backed / instant node to `<cwd>/<root>/nodes/<type>.node.json`. Nodes without a
 * `toPersisted()` (built-ins) are skipped and return `null`. Composite nodes are refused (this
 * workspace cannot rebuild their sub-runner on reload, so writing one would create an orphan the
 * loader can never reconstruct — see `loadInstantNodes`); they return `null` too.
 */
export async function saveInstantNodeFile(
  cwd: string,
  node: IDagNodeDefinition,
  createdAt: string,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<string | null> {
  if (!isPersistableInstantNode(node)) return null;
  const record = { ...node.toPersisted(), createdAt };
  if (record.kind === 'composite') return null;
  const dir = resolve(cwd, join(layout.root, 'nodes'));
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${node.nodeType}${NODE_MANIFEST_EXT}`);
  await writeFile(path, `${JSON.stringify(record, null, JSON_INDENT)}\n`, 'utf-8');
  return path;
}
