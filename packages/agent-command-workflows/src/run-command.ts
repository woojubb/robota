import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { isLegacyDefinitionFormat, toDagWorkflowFile } from '@robota-sdk/dag-builder';

import {
  DEFAULT_WORKSPACE_LAYOUT,
  type IDagWorkflowFile,
  type IWorkspaceLayout,
} from '@robota-sdk/dag-core';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';
import { parseFileArg } from './args.js';
import { createWorkspaceRuntime } from './workspace-runtime.js';

/**
 * Read a workflow file in either supported on-disk format and return the runtime workflow-file shape.
 * Legible legacy `IDagDefinition` files (what `create`/dag-cli save) are converted; ComfyUI-style
 * workflow files are used as-is.
 */
async function readDagFile(absPath: string): Promise<IDagWorkflowFile> {
  const raw = await readFile(absPath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  if (isLegacyDefinitionFormat(parsed)) {
    return toDagWorkflowFile(parsed).workflowFile;
  }
  return parsed as IDagWorkflowFile;
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
