import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { LocalDagRuntimeProvider } from '@robota-sdk/dag-framework';

import type { IDagWorkflowFile } from '@robota-sdk/dag-core';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

async function readDagFile(absPath: string): Promise<IDagWorkflowFile> {
  const raw = await readFile(absPath, 'utf-8');
  return JSON.parse(raw) as IDagWorkflowFile;
}

/**
 * `/workflows run <file.dag.json>` — execute a workflow file on the in-process DAG runtime.
 * Composes `dag-framework`'s local provider; no dependency on the `dag-cli` product.
 */
export async function executeWorkflowsRun(filePath: string, cwd: string): Promise<ICommandResult> {
  if (!filePath) {
    return { success: false, message: 'Usage: /workflows run <file.dag.json>' };
  }

  // The read/parse error is surfaced as a failed command result, not silently swallowed.
  const dag = await readDagFile(resolve(cwd, filePath)).catch((err: unknown) => {
    const detail = err instanceof Error ? err.message : String(err);
    return new Error(`Failed to read DAG file "${filePath}": ${detail}`);
  });
  if (dag instanceof Error) {
    return { success: false, message: dag.message };
  }

  const provider = new LocalDagRuntimeProvider();
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
