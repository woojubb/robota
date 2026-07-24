import { Robota } from '@robota-sdk/agent-core';

import { CompactionOrchestrator } from './compaction-orchestrator.js';
import { ContextWindowTracker } from './context-window-tracker.js';
import { PermissionEnforcer } from './permission-enforcer.js';

import type { ISessionOptions } from './session-types.js';
import type {
  IAgentConfig,
  IAIProvider,
  IEventService,
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
    // CORE-025: forward the background/subagent task permission policy + its own allow/deny lists.
    permissionPolicy: options.permissionPolicy,
    taskPermissions: options.taskPermissions,
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
    basePrompt: options.compactionBasePrompt,
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
  eventService: IEventService,
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
    // SELFHOST-004: the session-owned observable event bus. Tools (incl. the FunctionTool span
    // emit) are wired to it via the agent, so the interactive turn can subscribe to span-completion
    // events and project them onto session history. Absent this, the agent falls back to the no-op
    // default event service and no span events fire.
    eventService,
    ...(options.providerTimeout !== undefined && { timeout: options.providerTimeout }),
    ...(options.responseFormat ? { responseFormat: options.responseFormat } : {}),
    // CMD-005: the "ask the user" port rides the agent config into tool execution contexts.
    ...(options.ask ? { ask: options.ask } : {}),
  };
  return new Robota(agentConfig);
}
