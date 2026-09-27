import { realpathSync } from 'node:fs';
import { ExecutionRecoveryError } from '@robota-sdk/agent-core';
import type { IToolContinuation, TToolArgs, TToolParameters } from '@robota-sdk/agent-core';

const kind = 'robota-session/approval';

export function hasCheckpointedApproval(continuation: IToolContinuation | undefined): boolean {
  return continuation?.waits.some((wait) => wait.request.kind === kind) ?? false;
}

/** Current policy is checked by the enforcer; this can answer only the exact saved action. */
export async function checkpointedApproval(
  context: { sessionId: string; cwd: string; toolName: string; toolArgs: TToolArgs },
  continuation: IToolContinuation | undefined,
  requireApproval: boolean,
): Promise<boolean | undefined> {
  const waits = continuation?.waits.filter((wait) => wait.request.kind === kind) ?? [];
  if (!requireApproval && !waits.length) return undefined;
  if (!continuation || continuation.action.toolName !== context.toolName)
    throw new ExecutionRecoveryError(
      'EXECUTION_RECOVERY_INVALID',
      'Checkpointed approval requires the current journaled action',
    );
  const cwd = realpathSync(context.cwd);
  for (const { request } of waits) {
    if (
      request.data.version !== 1 ||
      request.data.sessionId !== context.sessionId ||
      request.data.cwd !== cwd ||
      request.data.toolName !== context.toolName
    )
      throw new ExecutionRecoveryError(
        'EXECUTION_RECOVERY_INVALID',
        'Saved approval belongs to a different Session or tool',
      );
  }
  const answer = await continuation.request({
    kind,
    data: {
      version: 1,
      sessionId: context.sessionId,
      cwd,
      toolName: context.toolName,
      // The Core continuation port validates finite JSON before persisting this value.
      arguments: structuredClone(context.toolArgs) as TToolParameters,
    },
  });
  if (Object.keys(answer).length !== 1 || typeof answer.approved !== 'boolean')
    throw new ExecutionRecoveryError(
      'EXECUTION_RECOVERY_INVALID',
      'Approval response must contain only a boolean approved decision',
    );
  return answer.approved;
}
