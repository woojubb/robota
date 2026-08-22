/**
 * The ONE construction point for the workspace's view of the DAG runtime (WORKFLOW-005 P3).
 *
 * A `/workflows` workspace has two node sources: the built-in registry `LocalDagRuntimeProvider`
 * loads by default, and the instant nodes `create`/`build` saved under `<root>/nodes/`. Every
 * subcommand that needs a node catalog (`list`, `validate`, `run`) resolves it here, so the catalog
 * a workflow is *validated* against is exactly the catalog it *runs* against — previously `validate`
 * and `list` built a bare provider and were blind to the workspace's own saved nodes, which made
 * `build`'s "Next steps: /workflows validate <path>" hand-off fail for every workflow it authored
 * with a new prompt node.
 */
import { DEFAULT_WORKSPACE_LAYOUT, type IWorkspaceLayout } from '@robota-sdk/dag-core';
import type { IDagNodeDefinition } from '@robota-sdk/dag-core';
import { LocalDagRuntimeProvider } from '@robota-sdk/dag-framework';

import { loadInstantNodes } from './persistence/instant-node-loader.js';
import { assertWorkflowProject } from './workflow-project.js';

import type { IWorkflowProject } from './workflow-project.js';

/** The workspace's runtime view: the provider plus the instant nodes that were folded into it. */
export interface IWorkspaceRuntime {
  /** Provider whose catalog = built-ins + the workspace's saved instant nodes. */
  readonly provider: LocalDagRuntimeProvider;
  /** The instant nodes reloaded from `<root>/nodes/` (empty when the workspace has none). */
  readonly instantNodes: readonly IDagNodeDefinition[];
}

/**
 * Build the workspace runtime for `cwd`: reload the saved instant nodes and hand them to a
 * `LocalDagRuntimeProvider` so both `listNodes()` and `execute()` see the full catalog.
 */
export async function createWorkspaceRuntime(
  project: IWorkflowProject,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<IWorkspaceRuntime> {
  const accepted = assertWorkflowProject(project);
  const instantNodes = await loadInstantNodes(accepted, layout);
  const provider = new LocalDagRuntimeProvider({
    executionRoot: accepted.executionRoot,
    workspace: layout,
    projectDir: accepted.executionRoot,
    ...(instantNodes.length > 0 ? { instantNodes } : {}),
  });
  return { provider, instantNodes };
}
