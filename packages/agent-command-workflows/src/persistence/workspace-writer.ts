/**
 * Writes authored workflows and prompt-backed nodes to the workspace, in the exact on-disk formats
 * the shared `scanWorkspaceCatalog` reader (dag-framework) expects: workflow definitions flat at
 * `<root>/<name><ext>`, node manifests at `<root>/nodes/<type>.node.json`. Kept in the agent layer
 * (not dag-framework) so the instant-node dependency doesn't pull agent-* into the dag layer.
 */
import { join } from 'node:path';
import { DEFAULT_WORKSPACE_LAYOUT, type IWorkspaceLayout } from '@robota-sdk/dag-core';
import type { IDagDefinition, IDagNodeDefinition } from '@robota-sdk/dag-core';
import { isPersistableInstantNode } from '@robota-sdk/dag-node-instant-node';
import { assertWorkflowProject } from '../workflow-project.js';

import type { IWorkflowProject } from '../workflow-project.js';

const NODE_MANIFEST_EXT = '.node.json';
const JSON_INDENT = 2;

/** Persist a workflow definition under `<root>/<name><ext>`. Returns its project-relative path. */
export async function saveWorkflowFile(
  project: IWorkflowProject,
  name: string,
  definition: IDagDefinition,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<string> {
  const path = join(layout.root, `${name}${layout.workflowExt}`);
  assertWorkflowProject(project).writeText(
    path,
    `${JSON.stringify(definition, null, JSON_INDENT)}\n`,
    'save authored workflow',
  );
  return path;
}

/**
 * Persist a prompt-backed / instant node under `<root>/nodes/<type>.node.json`. Nodes without a
 * `toPersisted()` (built-ins) are skipped and return `null`. Both prompt AND composite instant nodes
 * are persisted through the shared `toPersisted()` round-trip (`@robota-sdk/dag-node-instant-node`);
 * a composite's behavioral sub-runner is not serialized — `loadInstantNodes` rebuilds it on reload
 * (WORKFLOW-005 P2) — so a written composite is fully reloadable, not an orphan.
 */
export async function saveInstantNodeFile(
  project: IWorkflowProject,
  node: IDagNodeDefinition,
  createdAt: string,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<string | null> {
  if (!isPersistableInstantNode(node)) return null;
  const record = { ...node.toPersisted(), createdAt };
  const path = join(layout.root, 'nodes', `${node.nodeType}${NODE_MANIFEST_EXT}`);
  assertWorkflowProject(project).writeText(
    path,
    `${JSON.stringify(record, null, JSON_INDENT)}\n`,
    'save authored workflow node',
  );
  return path;
}
