import type { IAIProvider, IToolWithEventService, IHookTypeExecutor } from '@robota-sdk/agent-core';
import { SubagentManager, BackgroundTaskManager } from '@robota-sdk/agent-runtime';
import { AgentDefinitionLoader } from '../agents/agent-definition-loader.js';
import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import { storeAgentToolDeps } from '../tools/agent-tool.js';
import type { IAgentToolDeps } from '../tools/agent-tool.js';
import { createInProcessSubagentRunner } from '../subagents/in-process-subagent-runner.js';
import { fireSubagentLifecycleHook } from './background-task-hooks.js';
import type { IBackgroundTaskManager, TBackgroundTaskEvent } from '../background-tasks/index.js';
import { createExecutionOriginMetadata } from '../background-tasks/index.js';
import { createBackgroundProcessTool } from '../tools/background-process-tool.js';
import type { IBackgroundProcessToolDeps } from '../tools/background-process-tool.js';
import { buildSystemPrompt } from '../context/system-prompt-builder.js';
import type { ISystemPromptParams } from '../context/system-prompt-builder.js';
import { DEFAULT_TOOL_DESCRIPTIONS } from './create-tools.js';
import {
  createModelCommandToolProjection,
  formatProjectedModelCommandToolPromptDescription,
} from '../tools/model-command-tool-projection.js';
import type { ICapabilityDescriptor } from '../capabilities/types.js';
import type { ISessionLogger } from '@robota-sdk/agent-sessions';
import { storeSessionBackgroundTaskManager } from '../background-tasks/session-background-store.js';
import type { Session } from '@robota-sdk/agent-sessions';
import type { ICreateSessionOptions } from './create-session-types.js';

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

  if (options.enableAgentRuntime) {
    const agentLoader = new AgentDefinitionLoader(cwd);
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

export interface IBackgroundProcessResult {
  backgroundProcessToolDeps: IBackgroundProcessToolDeps | undefined;
}

export function buildBackgroundProcessTool(
  options: ICreateSessionOptions,
  backgroundTaskManager: IBackgroundTaskManager,
  sessionId: string,
  cwd: string,
  tools: IToolWithEventService[],
): IBackgroundProcessResult {
  const hasProcessRunner = options.backgroundTaskRunners?.some((r) => r.kind === 'process');
  if (!hasProcessRunner) return { backgroundProcessToolDeps: undefined };
  const backgroundProcessToolDeps: IBackgroundProcessToolDeps = {
    backgroundTaskManager,
    cwd,
    parentSessionId: sessionId,
    metadata: createExecutionOriginMetadata({
      kind: 'tool_call',
      sessionId,
      label: 'BackgroundProcess',
    }),
  };
  tools.push(createBackgroundProcessTool(backgroundProcessToolDeps));
  return { backgroundProcessToolDeps };
}

export interface ISystemPromptResult {
  finalSystemMessage: string;
  rebuildSystemMessage: (agentsMd: string, claudeMd: string) => string;
}

export function buildSessionSystemPrompt(
  options: ICreateSessionOptions,
  cwd: string,
  modelInvocableCommandDescriptors: ICapabilityDescriptor[],
  modelCommandToolProjection: ReturnType<typeof createModelCommandToolProjection> | undefined,
  backgroundProcessToolDeps: IBackgroundProcessToolDeps | undefined,
  modelVisibleSkills: Array<{
    name: string;
    description: string;
    disableModelInvocation?: boolean;
  }>,
  agentDefinitions: IAgentDefinition[],
): ISystemPromptResult {
  const buildPrompt = options.systemPromptBuilder ?? buildSystemPrompt;
  const defaultToolDescriptions = [
    ...DEFAULT_TOOL_DESCRIPTIONS,
    ...(modelCommandToolProjection
      ? modelCommandToolProjection.commandTools.map(
          formatProjectedModelCommandToolPromptDescription,
        )
      : []),
  ];
  const resolvedToolDescriptions =
    options.toolDescriptions ??
    (backgroundProcessToolDeps
      ? [
          ...defaultToolDescriptions,
          'BackgroundProcess — start long-running shell commands as managed background tasks',
        ]
      : defaultToolDescriptions);

  const staticPromptParams: ISystemPromptParams = {
    agentsMd: options.context.agentsMd,
    claudeMd: options.context.claudeMd,
    memoryMd: options.context.memoryMd,
    taskContext: options.context.taskContext,
    toolDescriptions: resolvedToolDescriptions,
    trustLevel: options.config.defaultTrustLevel,
    projectInfo: options.projectInfo ?? { type: 'unknown', language: 'unknown' },
    cwd,
    language: options.config.language,
    skills: modelVisibleSkills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      disableModelInvocation: skill.disableModelInvocation,
    })),
    ...(agentDefinitions.length > 0
      ? {
          agents: agentDefinitions.map((agent) => ({
            name: agent.name,
            description: agent.description,
          })),
        }
      : {}),
    commandDescriptors: options.commandDescriptors ?? [],
  };
  const systemMessage = buildPrompt(staticPromptParams);
  const finalSystemMessage = options.appendSystemPrompt
    ? `${systemMessage}\n\n${options.appendSystemPrompt}`
    : systemMessage;

  const rebuildSystemMessage = (newAgentsMd: string, newClaudeMd: string): string => {
    const rebuilt = buildPrompt({
      ...staticPromptParams,
      agentsMd: newAgentsMd,
      claudeMd: newClaudeMd,
    });
    return options.appendSystemPrompt ? `${rebuilt}\n\n${options.appendSystemPrompt}` : rebuilt;
  };

  return { finalSystemMessage, rebuildSystemMessage };
}

export function wireSessionDeps(
  session: Session,
  agentToolDeps: IAgentToolDeps | undefined,
  backgroundProcessToolDeps: IBackgroundProcessToolDeps | undefined,
  backgroundTaskManager: IBackgroundTaskManager,
): void {
  if (agentToolDeps) agentToolDeps.parentSessionId = session.getSessionId();
  if (backgroundProcessToolDeps) backgroundProcessToolDeps.parentSessionId = session.getSessionId();
  storeSessionBackgroundTaskManager(session, backgroundTaskManager);
  if (agentToolDeps) storeAgentToolDeps(session, agentToolDeps);
}

function logBackgroundTaskEvent(
  logger: ISessionLogger,
  sessionId: string,
  event: TBackgroundTaskEvent,
): void {
  logger.log(sessionId, 'background_task_event', {
    backgroundEventType: event.type,
    backgroundEvent: event,
  });
}
