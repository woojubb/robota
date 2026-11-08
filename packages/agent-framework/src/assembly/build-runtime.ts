/**
 * The robota slice of session assembly, split out of `create-session-runtime.ts`.
 *
 * Owns the subagent/background-dispatch wiring: the agent-definition roster (built-ins composed with any
 * composition-root-contributed `agentDefinitions`), the agent-tool deps, the `SubagentManager`, and the
 * background-task manager + its logging/lifecycle subscriptions.
 */

import { SubagentManager, BackgroundTaskManager } from '@robota-sdk/agent-executor';

import {
  fireSubagentLifecycleHook,
  validateSubagentHookEnvironmentNames,
} from './background-task-hooks.js';
import { AgentDefinitionLoader } from '../agents/agent-definition-loader.js';
import { BUILT_IN_AGENTS } from '../agents/built-in-agents.js';
import { createInProcessSubagentRunner } from '../subagents/in-process-subagent-runner.js';

import type { ICreateSessionOptions } from './create-session-types.js';
import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import type { IAgentToolDeps } from '../tools/agent-tool.js';
import type { IAIProvider, IToolWithEventService, IHookTypeExecutor } from '@robota-sdk/agent-core';
import type { IBackgroundTaskManager, TObserverFailureReporter } from '@robota-sdk/agent-executor';
import type { TBackgroundTaskEvent } from '@robota-sdk/agent-interface/execution';
import type { ISessionLogger } from '@robota-sdk/agent-session';

export interface IAgentRuntimeResult {
  agentToolDeps: IAgentToolDeps | undefined;
  agentDefinitions: IAgentDefinition[];
  backgroundTaskManager: IBackgroundTaskManager;
}

/**
 * The reporter a lifecycle-observer failure goes to: the host's, given the warning code the product
 * chose. A host that lends none leaves the executor's own line (a `console.warn` carrying the code).
 */
function observerFailureReporter(
  options: Pick<ICreateSessionOptions, 'host' | 'observerFailureWarningCode'>,
): { onObserverFailure?: TObserverFailureReporter<TBackgroundTaskEvent> } {
  const report = options.host.reportObserverFailure;
  return report === undefined
    ? {}
    : { onObserverFailure: (failure) => report(failure, options.observerFailureWarningCode) };
}

export function buildAgentRuntime(
  options: ICreateSessionOptions,
  sessionId: string,
  cwd: string,
  provider: IAIProvider,
  tools: IToolWithEventService[],
  hookTypeExecutors: IHookTypeExecutor[],
): IAgentRuntimeResult {
  const environmentNames = options.subagentHookEnvironmentNames
    ? { ...options.subagentHookEnvironmentNames }
    : undefined;
  validateSubagentHookEnvironmentNames(environmentNames);
  let agentToolDeps: IAgentToolDeps | undefined;
  let agentDefinitions: IAgentDefinition[] = [];
  let backgroundTaskManager: IBackgroundTaskManager;

  // A preset opting into parallel subagents activates the agent runtime
  // (subagent/background dispatch) exactly like an explicit enableAgentRuntime.
  if (options.enableAgentRuntime || options.enableParallelSubagents) {
    // The subagent roster is INJECTABLE — pack-contributed definitions compose into the
    // built-in tier ahead of `BUILT_IN_AGENTS`. Precedence: discovered > injected > built-in.
    const builtInTier = options.agentDefinitions
      ? [...options.agentDefinitions, ...BUILT_IN_AGENTS]
      : BUILT_IN_AGENTS;
    const agentLoader = new AgentDefinitionLoader(
      options.contributionSources ?? [],
      builtInTier,
      options.agentDefinitionRoots ?? [],
    );
    agentDefinitions = agentLoader.loadAll();
    agentToolDeps = {
      host: options.host,
      pathProtection: options.pathProtection,
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
      hookTypeExecutors,
      onTextDelta: options.onTextDelta,
      onToolExecution: options.onToolExecution,
      customAgentRegistry: (name: string) => agentLoader.getAgent(name),
      agentDefinitions,
      commandSemanticRoles: options.commandSemanticRoles,
      modelCommandToolPrefix: options.modelCommandToolPrefix,
      // The parent's session-shaped choices, carried to the runner because a
      // runner that rebuilds the tool surface in ANOTHER process has no other way to learn them.
      // The in-process runner ignores all three — it receives `tools` already assembled — which is
      // exactly why they were missing: the sibling that needed them is not the one being read here.
      sessionTiers: { includeGoalTool: options.includeGoalTool === true },
      ...(options.sandboxClient !== undefined ? { sandboxClient: options.sandboxClient } : {}),
      ...(options.sandboxType !== undefined ? { sandboxType: options.sandboxType } : {}),
      // Where a fork job's record lives, so the in-process runner can restore it.
      ...(options.resumeSessionStore !== undefined
        ? { resumeSessionStore: options.resumeSessionStore }
        : {}),
    };
    const subagentManager = new SubagentManager({
      runner: (options.subagentRunnerFactory ?? createInProcessSubagentRunner)(agentToolDeps),
      backgroundTaskRunners: options.backgroundTaskRunners,
      observerFailureWarningCode: options.observerFailureWarningCode,
      ...observerFailureReporter(options),
    });
    agentToolDeps.subagentManager = subagentManager;
    backgroundTaskManager = subagentManager.getBackgroundTaskManager();
    agentToolDeps.backgroundTaskManager = backgroundTaskManager;
  } else {
    backgroundTaskManager = new BackgroundTaskManager({
      runners: options.backgroundTaskRunners ?? [],
      observerFailureWarningCode: options.observerFailureWarningCode,
      ...observerFailureReporter(options),
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
      event, cwd, options.config.hooks, hookTypeExecutors, environmentNames,
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
