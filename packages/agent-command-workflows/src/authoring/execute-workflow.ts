/**
 * Runs an assembled `IDagDefinition` on the in-process local runtime with a given set of extra
 * (prompt-backed / local) nodes registered. Shared by `create` (in-memory authored nodes) and
 * `run` (nodes reloaded from disk).
 */
import { LocalDagRuntimeProvider } from '@robota-sdk/dag-framework';
import type { IDagDefinition, IDagNodeDefinition, IWorkspaceLayout } from '@robota-sdk/dag-core';

export interface IWorkflowRunOutcome {
  readonly ok: boolean;
  readonly outputs: Record<string, unknown>;
  readonly durationMs: number;
  readonly error?: string;
}

export async function executeDefinition(
  definition: IDagDefinition,
  cwd: string,
  layout: IWorkspaceLayout,
  instantNodes: IDagNodeDefinition[],
  inputs: Record<string, unknown>,
): Promise<IWorkflowRunOutcome> {
  const provider = new LocalDagRuntimeProvider({
    executionRoot: cwd,
    workspace: layout,
    projectDir: cwd,
    ...(instantNodes.length > 0 ? { instantNodes } : {}),
  });
  const result = await provider.execute(definition, inputs);
  return {
    ok: result.ok,
    outputs: result.outputs,
    durationMs: result.durationMs,
    ...(result.ok ? {} : { error: result.error ?? 'unknown error' }),
  };
}
