import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { dagDefinitionFromParsedFile } from '@robota-sdk/dag-builder';

import {
  DEFAULT_WORKSPACE_LAYOUT,
  type IDagDefinition,
  type IWorkspaceLayout,
} from '@robota-sdk/dag-core';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';
import { parseFileArg } from './args.js';
import { createWorkspaceRuntime } from './workspace-runtime.js';

/**
 * Read a workflow file in either supported on-disk format and return the canonical domain model.
 *
 * DAG-002: this is the import adapter, and it is the only place the file format belongs. It used to
 * run the other way — an `IDagDefinition` file was converted INTO the workflow-file format because
 * that was the provider's parameter type, and the provider converted it straight back, losing the
 * node ids and port names on the way. A definition on disk is now passed through untouched, and only
 * a genuine workflow file is converted.
 */
async function readDagFile(absPath: string): Promise<IDagDefinition> {
  return dagDefinitionFromParsedFile(JSON.parse(await readFile(absPath, 'utf-8')));
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
  cwd: string,
  workspace: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<ICommandResult> {
  const parsedArgs = parseFileArg(argStr, 'run');
  if (!parsedArgs.ok) {
    return { success: false, message: parsedArgs.error };
  }
  const filePath = parsedArgs.value;

  // The read/parse error is surfaced as a failed command result, not silently swallowed.
  const dag = await readDagFile(resolve(cwd, filePath)).catch((err: unknown) => {
    const detail = err instanceof Error ? err.message : String(err);
    return new Error(`Failed to read DAG file "${filePath}": ${detail}`);
  });
  if (dag instanceof Error) {
    return { success: false, message: dag.message };
  }

  // Shared workspace runtime: built-ins + any prompt/composite nodes saved under `<root>/nodes/`.
  const { provider } = await createWorkspaceRuntime(cwd, workspace);
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
