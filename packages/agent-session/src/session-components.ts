import { Robota } from '@robota-sdk/agent-core';

import { CompactionOrchestrator } from './compaction-orchestrator.js';
import { ContextWindowTracker } from './context-window-tracker.js';
import { PermissionEnforcer } from './permission-enforcer.js';

import type { ISessionOptions } from './session-types.js';
import type {
  IAgentConfig,
  IAIProvider,
  IToolWithEventService,
  TPermissionMode,
} from '@robota-sdk/agent-core';

export function buildPermissionEnforcer(
  options: ISessionOptions,
  sessionId: string,
  cwd: string,
  getPermissionMode: () => TPermissionMode,
  transcriptPath: string | undefined,
): PermissionEnforcer {
  return new PermissionEnforcer({
    sessionId,
    cwd,
    getPermissionMode,
    config: {
      permissions: options.permissions ?? { allow: [], deny: [] },
      hooks: options.hooks,
    },
    terminal: options.terminal,
    permissionHandler: options.permissionHandler,
    promptForApprovalFn: options.promptForApproval,
    sessionLogger: options.sessionLogger,
    onToolExecution: options.onToolExecution,
    hookTypeExecutors: options.hookTypeExecutors,
    transcriptPath,
    onProjectAllowTool: options.onProjectAllowTool,
  });
}

export function buildSessionTrackers(
  options: ISessionOptions,
  model: string,
  sessionId: string,
  cwd: string,
): { contextTracker: ContextWindowTracker; compactionOrchestrator: CompactionOrchestrator } {
  const contextTracker = new ContextWindowTracker(
    model,
    options.contextMaxTokens,
    options.autoCompactThreshold,
  );
  const compactionOrchestrator = new CompactionOrchestrator({
    sessionId,
    cwd,
    model,
    hooks: options.hooks,
    compactInstructions: options.compactInstructions,
    hookTypeExecutors: options.hookTypeExecutors,
  });
  return { contextTracker, compactionOrchestrator };
}

export function buildRobota(
  options: ISessionOptions,
  permissionEnforcer: PermissionEnforcer,
  tools: IToolWithEventService[],
  provider: IAIProvider,
  model: string,
  systemMessage: string,
): Robota {
  const wrappedTools = permissionEnforcer.wrapTools(tools);
  const agentConfig: IAgentConfig = {
    name: options.agentName ?? 'agent',
    aiProviders: [provider],
    defaultModel: {
      provider: provider.name,
      model,
      ...(options.effort !== undefined && { effort: options.effort }),
    },
    // Single source of truth for the system prompt (agent-level, not model config).
    systemMessage,
    tools: wrappedTools,
    logging: { enabled: false },
    ...(options.providerTimeout !== undefined && { timeout: options.providerTimeout }),
    ...(options.responseFormat ? { responseFormat: options.responseFormat } : {}),
  };
  return new Robota(agentConfig);
}
