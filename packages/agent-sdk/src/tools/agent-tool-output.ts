import type { ISubagentJobResult } from '../subagents/index.js';

export function stringifyUnknownAgentType(agentType: string): string {
  return JSON.stringify({
    success: false,
    mode: 'single',
    requestedJobCount: 1,
    startedJobCount: 0,
    failedJobCount: 1,
    output: '',
    error: `Unknown agent type: ${agentType}`,
    provenance: {
      source: 'agent-tool-single',
      requestedJobCount: 1,
      startedJobCount: 0,
      failedJobCount: 1,
    },
  });
}

export function stringifyAgentSuccess(result: ISubagentJobResult): string {
  const worktreePath = result.metadata?.['worktreePath'];
  const branchName = result.metadata?.['branchName'];
  const worktreeStatus = result.metadata?.['worktreeStatus'];
  const worktreeNextAction = result.metadata?.['worktreeNextAction'];
  return JSON.stringify({
    success: true,
    mode: 'single',
    requestedJobCount: 1,
    startedJobCount: 1,
    failedJobCount: 0,
    output: result.output,
    agentId: result.jobId,
    agentIds: [result.jobId],
    provenance: {
      source: 'agent-tool-single',
      requestedJobCount: 1,
      startedJobCount: 1,
      failedJobCount: 0,
    },
    metadata: result.metadata,
    ...(typeof worktreePath === 'string' ? { worktreePath } : {}),
    ...(typeof branchName === 'string' ? { branchName } : {}),
    ...(typeof worktreeStatus === 'string' ? { worktreeStatus } : {}),
    ...(typeof worktreeNextAction === 'string' ? { worktreeNextAction } : {}),
  });
}

export function stringifyAgentError(message: string, agentId?: string): string {
  const startedJobCount = agentId === undefined ? 0 : 1;
  return JSON.stringify({
    success: false,
    mode: 'single',
    requestedJobCount: 1,
    startedJobCount,
    failedJobCount: 1,
    output: '',
    error: `Sub-agent error: ${message}`,
    agentId,
    ...(agentId !== undefined ? { agentIds: [agentId] } : {}),
    provenance: {
      source: 'agent-tool-single',
      requestedJobCount: 1,
      startedJobCount,
      failedJobCount: 1,
    },
  });
}
