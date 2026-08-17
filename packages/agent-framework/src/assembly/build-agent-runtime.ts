/**
 * ARCH-005 — the agent-runtime slice of session assembly, split out of `create-session-runtime.ts`.
 *
 * Owns the subagent/background-dispatch wiring: the agent-definition roster (built-ins composed with any
 * composition-root-contributed `agentDefinitions`), the agent-tool deps, the `SubagentManager`, and the
 * background-task manager + its logging/lifecycle subscriptions.
 */

import { SubagentManager, BackgroundTaskManager } from '@robota-sdk/agent-executor';

import { fireSubagentLifecycleHook } from './background-task-hooks.js';
import { AgentDefinitionLoader } from '../agents/agent-definition-loader.js';
import { BUILT_IN_AGENTS } from '../agents/built-in-agents.js';
import { createInProcessSubagentRunner } from '../subagents/in-process-subagent-runner.js';

import type { ICreateSessionOptions } from './create-session-types.js';
import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import type { IAgentToolDeps } from '../tools/agent-tool.js';
import type { IAIProvider, IToolWithEventService, IHookTypeExecutor } from '@robota-sdk/agent-core';
import type { IBackgroundTaskManager } from '@robota-sdk/agent-executor';
import type { TBackgroundTaskEvent } from '@robota-sdk/agent-interface-transport';
import type { ISessionLogger } from '@robota-sdk/agent-session';

export interface IAgentRuntimeResult {
  agentToolDeps: IAgentToolDeps | undefined;
  agentDefinitions: IAgentDefinition[];
  backgroundTaskManager: IBackgroundTaskManager;
}

export function buildAgentRuntime(
  options: ICreateSessionOptions,
  sessionId: string,
  cwd: string,
  provider: IAIProvider,
  tools: IToolWithEventService[],
  hookTypeExecutors: IHookTypeExecutor[],
): IAgentRuntimeResult {
  let agentToolDeps: IAgentToolDeps | undefined;
  let agentDefinitions: IAgentDefinition[] = [];
  let backgroundTaskManager: IBackgroundTaskManager;

  // PRESET-004: a preset opting into parallel subagents activates the agent runtime
  // (subagent/background dispatch) exactly like an explicit enableAgentRuntime.
  if (options.enableAgentRuntime || options.enableParallelSubagents) {
    // ARCH-005: the subagent roster is INJECTABLE — pack-contributed definitions compose into the
    // built-in tier ahead of `BUILT_IN_AGENTS`. Precedence: discovered > injected > built-in.
    const builtInTier = options.agentDefinitions
      ? [...options.agentDefinitions, ...BUILT_IN_AGENTS]
      : BUILT_IN_AGENTS;
    const agentLoader = new AgentDefinitionLoader(cwd, undefined, undefined, builtInTier);
    agentDefinitions = agentLoader.loadAll();
    agentToolDeps = {
      config: options.config,
      context: options.context,
      tools,
      terminal: options.terminal,
      provider,
      cwd,
      parentSessionId: sessionId,
      permissionMode: options.permissionMode,
      permissionHandler: options.permissionHandler,
      hooks: options.config.hooks,
      hookTypeExecutors: hookTypeExecutors.length > 0 ? hookTypeExecutors : undefined,
      onTextDelta: options.onTextDelta,
      onToolExecution: options.onToolExecution,
      customAgentRegistry: (name: string) => agentLoader.getAgent(name),
      agentDefinitions,
      commandSemanticRoles: options.commandSemanticRoles,
    };
    const subagentManager = new SubagentManager({
      runner: (options.subagentRunnerFactory ?? createInProcessSubagentRunner)(agentToolDeps),
      backgroundTaskRunners: options.backgroundTaskRunners,
    });
    agentToolDeps.subagentManager = subagentManager;
    backgroundTaskManager = subagentManager.getBackgroundTaskManager();
    agentToolDeps.backgroundTaskManager = backgroundTaskManager;
  } else {
    backgroundTaskManager = new BackgroundTaskManager({
      runners: options.backgroundTaskRunners ?? [],
    });
  }

  const sessionLogger = options.sessionLogger;
  if (sessionLogger) {
    backgroundTaskManager.subscribe((event) =>
      logBackgroundTaskEvent(sessionLogger, sessionId, event),
    );
  }
  backgroundTaskManager.subscribe((event) =>
    fireSubagentLifecycleHook(
      event,
      cwd,
      options.config.hooks,
      hookTypeExecutors.length > 0 ? hookTypeExecutors : undefined,
    ),
  );

  return { agentToolDeps, agentDefinitions, backgroundTaskManager };
}

function logBackgroundTaskEvent(
  logger: ISessionLogger,
  sessionId: string,
  event: TBackgroundTaskEvent,
): void {
  const correlationFields: Record<string, string> = {};
  if (event.type === 'background_task_created') {
    correlationFields['taskId'] = event.task.id;
    const originToolCallId = event.task.metadata?.['executionOriginToolCallId'];
    if (typeof originToolCallId === 'string') {
      correlationFields['originToolCallId'] = originToolCallId;
    }
  }
  logger.log(sessionId, 'background_task_event', {
    backgroundEventType: event.type,
    backgroundEvent: event,
    ...correlationFields,
  });
}
