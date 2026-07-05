/**
 * Persistence path + extension constants (DATA-002). Dependency-free leaf so the store, the code-node
 * adapter, the loader, and handlers can share `.dag/` path knowledge without an import cycle.
 */
import { join } from 'node:path';

/** Universal node manifest extension (generalized from BEHAVIOR-006's `.instant-node.json`). */
export const NODE_MANIFEST_EXT = '.node.json';

/** Workflow file extension. */
export const WORKFLOW_EXT = '.dag.json';

/** The `.dag/nodes/` directory for a project. */
export function nodesDir(projectDir: string): string {
  return join(projectDir, '.dag', 'nodes');
}

/** The `.dag/workflows/` directory for a project. */
export function workflowsDir(projectDir: string): string {
  return join(projectDir, '.dag', 'workflows');
}
