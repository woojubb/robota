/**
 * `/workflows create "<natural-language description>" [--input key=value ...] [--name <name>]`
 *
 * Authors a workflow from a natural-language description using the agent-cli's ACTIVE provider,
 * saves it as a reusable `.workflows/<name>.json` artifact (plus any prompt-backed nodes under
 * `.workflows/nodes/`), runs it immediately in-process, and surfaces the saved path + outputs.
 *
 * FLOW-007 Phase 2 (existing nodes) + Phase 3 (on-the-fly prompt nodes). The author→save half is the
 * shared `authoring/pipeline.ts` (WORKFLOW-005 P3); `create` is that pipeline plus the run step —
 * the ONLY difference between `create` and `build`.
 */
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';
import type { IWorkflowProject } from './workflow-project.js';
import { DEFAULT_WORKSPACE_LAYOUT } from '@robota-sdk/dag-core';

import { authorAndSaveWorkflow } from './authoring/pipeline.js';
import { executeDefinition } from './authoring/execute-workflow.js';
import type { IWorkflowsAuthoringDeps } from './authoring/args.js';

function formatOutputs(outputs: Record<string, unknown>): string {
  return JSON.stringify(outputs, null, 2);
}

/**
 * Execute `/workflows create`. Never throws — every failure (bad args, no provider, invalid spec,
 * unassemblable pipeline, run failure) is returned as a failed `ICommandResult`.
 */
export async function executeWorkflowsCreate(
  argStr: string,
  project: IWorkflowProject,
  deps: IWorkflowsAuthoringDeps = {},
): Promise<ICommandResult> {
  const layout = deps.workspace ?? DEFAULT_WORKSPACE_LAYOUT;

  const authored = await authorAndSaveWorkflow(argStr, project, 'create', deps);
  if (!authored.ok) {
    return { success: false, message: authored.message };
  }
  const { name, definition, workflowPath, savedNodePaths, runNodes, runInputs } = authored.value;

  const outcome = await executeDefinition(
    definition,
    project.executionRoot,
    layout,
    [...runNodes],
    runInputs,
  );

  const nodeLine = savedNodePaths.length > 0 ? `\nNew nodes: ${savedNodePaths.join(', ')}` : '';
  if (!outcome.ok) {
    return {
      success: false,
      message: `Saved ${workflowPath}${nodeLine}\nBut the run failed (${outcome.durationMs}ms): ${outcome.error}\nInspect or edit the saved artifact and re-run with: /workflows run ${workflowPath}`,
    };
  }
  return {
    success: true,
    message: `Created and ran "${name}".\nSaved: ${workflowPath}${nodeLine}\nCompleted in ${outcome.durationMs}ms.\nOutputs: ${formatOutputs(outcome.outputs)}\nRe-run: /workflows run ${workflowPath}`,
  };
}
