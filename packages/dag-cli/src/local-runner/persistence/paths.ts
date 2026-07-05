/**
 * Persistence path helpers (DATA-002, parameterized in FLOW-007). The workspace root + workflow
 * extension are injected via an `IWorkspaceLayout` (owned by each product's composition root), not
 * hardcoded. Defaults to `.workflows/` with flat `.json` workflow definitions.
 */
import { join } from 'node:path';
import { DEFAULT_WORKSPACE_LAYOUT, type IWorkspaceLayout } from '@robota-sdk/dag-core';

/** Universal node manifest extension (generalized from BEHAVIOR-006's `.instant-node.json`). */
export const NODE_MANIFEST_EXT = '.node.json';

/** Default workflow-definition extension (from the default layout). Prefer the injected layout. */
export const WORKFLOW_EXT = DEFAULT_WORKSPACE_LAYOUT.workflowExt;

/** The nodes directory: `<root>/nodes/`. */
export function nodesDir(
  projectDir: string,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): string {
  return join(projectDir, layout.root, 'nodes');
}

/**
 * The directory holding workflow definitions — flat under the workspace **root** (FLOW-007 removed the
 * redundant `.dag/workflows/` level; definitions now live as `<root>/<name><workflowExt>`).
 */
export function workflowsDir(
  projectDir: string,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): string {
  return join(projectDir, layout.root);
}
