import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { LocalDagRuntimeProvider } from '@robota-sdk/dag-framework';
import { isLegacyDefinitionFormat, toDagWorkflowFile } from '@robota-sdk/dag-builder';

import {
  DEFAULT_WORKSPACE_LAYOUT,
  type IDagWorkflowFile,
  type IWorkspaceLayout,
} from '@robota-sdk/dag-core';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';
import { loadInstantNodes } from './persistence/instant-node-loader.js';

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
 * `/workflows run <file.dag.json>` — execute a workflow file on the in-process DAG runtime.
 * Composes `dag-framework`'s local provider; no dependency on the `dag-cli` product.
 */
export async function executeWorkflowsRun(
  filePath: string,
  cwd: string,
  workspace: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<ICommandResult> {
  if (!filePath) {
    return { success: false, message: 'Usage: /workflows run <file.json>' };
  }

  // The read/parse error is surfaced as a failed command result, not silently swallowed.
  const dag = await readDagFile(resolve(cwd, filePath)).catch((err: unknown) => {
    const detail = err instanceof Error ? err.message : String(err);
    return new Error(`Failed to read DAG file "${filePath}": ${detail}`);
  });
  if (dag instanceof Error) {
    return { success: false, message: dag.message };
  }

  // Reload any prompt-backed nodes from `<root>/nodes/` so workflows referencing them can run.
  const instantNodes = await loadInstantNodes(cwd, workspace);
  const provider = new LocalDagRuntimeProvider({
    workspace,
    projectDir: cwd,
    ...(instantNodes.length > 0 ? { instantNodes } : {}),
  });
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
