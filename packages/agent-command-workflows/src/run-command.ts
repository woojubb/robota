import { dagDefinitionFromParsedFile } from '@robota-sdk/dag-builder';

import {
  DEFAULT_WORKSPACE_LAYOUT,
  type IDagDefinition,
  type IWorkspaceLayout,
} from '@robota-sdk/dag-core';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';
import { parseFileArg } from './args.js';
import { createWorkspaceRuntime } from './workspace-runtime.js';
import { assertWorkflowProject } from './workflow-project.js';

import type { IWorkflowProject } from './workflow-project.js';

/**
 * Read a workflow file in either supported on-disk format and return the canonical domain model.
 *
 * DAG-002: this is the import adapter, and it is the only place the file format belongs. It used to
 * run the other way — an `IDagDefinition` file was converted INTO the workflow-file format because
 * that was the provider's parameter type, and the provider converted it straight back, losing the
 * node ids and port names on the way. A definition on disk is now passed through untouched, and only
 * a genuine workflow file is converted.
 */
function readDagFile(project: IWorkflowProject, relativePath: string): IDagDefinition {
  const raw = assertWorkflowProject(project).readText(relativePath, 'run workflow definition');
  if (raw === undefined) throw new Error('workflow file was not found');
  return dagDefinitionFromParsedFile(JSON.parse(raw));
}

/**
 * `/workflows run <file.json>` — execute a workflow file on the in-process DAG runtime. The node
 * catalog is resolved through the shared workspace runtime (built-ins + the instant nodes saved
 * under `<root>/nodes/`), the same one `validate` and `list` see (WORKFLOW-005 P3), and the argument
 * shares the `/workflows` grammar (`parseFileArg`). Composes `dag-framework`'s local provider; no
 * dependency on the `dag-cli` product.
 */
export async function executeWorkflowsRun(
  argStr: string,
  project: IWorkflowProject,
  workspace: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<ICommandResult> {
  const parsedArgs = parseFileArg(argStr, 'run');
  if (!parsedArgs.ok) {
    return { success: false, message: parsedArgs.error };
  }
  const filePath = parsedArgs.value;

  // The read/parse error is surfaced as a failed command result, not silently swallowed.
  let dag: IDagDefinition | Error;
  try {
    dag = readDagFile(project, filePath);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    dag = new Error(`Failed to read DAG file "${filePath}": ${detail}`);
  }
  if (dag instanceof Error) {
    return { success: false, message: dag.message };
  }

  // Shared workspace runtime: built-ins + any prompt/composite nodes saved under `<root>/nodes/`.
  const { provider } = await createWorkspaceRuntime(project, workspace);
  const result = await provider.execute(dag, {});
  if (!result.ok) {
    return {
      success: false,
      message: `Workflow failed (${result.durationMs}ms): ${result.error ?? 'unknown error'}`,
    };
  }
  return {
    success: true,
    message: `Workflow completed in ${result.durationMs}ms.\nOutputs: ${JSON.stringify(result.outputs, null, 2)}`,
  };
}
