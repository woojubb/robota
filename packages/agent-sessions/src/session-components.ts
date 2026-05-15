import { Robota } from '@robota-sdk/agent-core';
import type {
  IAgentConfig,
  IAIProvider,
  IToolWithEventService,
  TPermissionMode,
} from '@robota-sdk/agent-core';
import { PermissionEnforcer } from './permission-enforcer.js';
import { ContextWindowTracker } from './context-window-tracker.js';
import { CompactionOrchestrator } from './compaction-orchestrator.js';
import type { ISessionOptions } from './session-types.js';

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
    name: 'robota-cli',
    aiProviders: [provider],
    defaultModel: {
      provider: provider.name,
      model,
      systemMessage,
    },
    systemMessage,
    tools: wrappedTools,
    logging: { enabled: false },
    ...(options.providerTimeout !== undefined && { timeout: options.providerTimeout }),
  };
  return new Robota(agentConfig);
}
