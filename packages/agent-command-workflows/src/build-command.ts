/**
 * `/workflows build "<natural-language description>" [--input key=value ...] [--name <name>]`
 *
 * The generate-for-review counterpart to `create` (WORKFLOW-004): authors a workflow from a
 * natural-language description via the ACTIVE provider, validates + assembles it, and saves it as a
 * reusable `.workflows/<name>.json` artifact (plus any prompt-backed nodes under
 * `.workflows/nodes/`) — and STOPS. It never executes the authored graph: `build` runs only the
 * shared `authoring/pipeline.ts`, which by construction does not import
 * `authoring/execute-workflow.ts`, so no DAG runtime is constructed and no node (LLM or
 * side-effecting) runs. The explicit next steps are the existing `validate` / `run` subcommands.
 */
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';
import type { IWorkflowProject } from './workflow-project.js';

import { authorAndSaveWorkflow } from './authoring/pipeline.js';
import type { IWorkflowsAuthoringDeps } from './authoring/args.js';

/**
 * Execute `/workflows build`. Never throws — every failure (bad args, no provider, invalid spec,
 * unassemblable pipeline, write failure) is returned as a failed `ICommandResult`. Shares the
 * authoring deps seam (`IWorkflowsAuthoringDeps`) and arg grammar (`parseAuthoringArgs`) with
 * `create`; the two differ only in what happens after the artifact is saved.
 */
export async function executeWorkflowsBuild(
  argStr: string,
  project: IWorkflowProject,
  deps: IWorkflowsAuthoringDeps = {},
): Promise<ICommandResult> {
  const authored = await authorAndSaveWorkflow(argStr, project, 'build', deps);
  if (!authored.ok) {
    return { success: false, message: authored.message };
  }
  const { name, definition, workflowPath, savedNodePaths } = authored.value;

  const nodeLine = savedNodePaths.length > 0 ? `\nNew nodes: ${savedNodePaths.join(', ')}` : '';
  return {
    success: true,
    message:
      `Built "${name}" (${definition.nodes.length} node(s), ${definition.edges.length} edge(s)) — saved, not run.\n` +
      `Saved: ${workflowPath}${nodeLine}\n` +
      `Next steps:\n` +
      `  /workflows validate ${workflowPath}\n` +
      `  /workflows run ${workflowPath}`,
  };
}
