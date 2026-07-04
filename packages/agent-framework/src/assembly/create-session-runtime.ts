import { TRUST_TO_MODE } from '@robota-sdk/agent-core';
import { SubagentManager, BackgroundTaskManager } from '@robota-sdk/agent-executor';

import { fireSubagentLifecycleHook } from './background-task-hooks.js';
import { DEFAULT_TOOL_DESCRIPTIONS } from './create-tools.js';
import { AgentDefinitionLoader } from '../agents/agent-definition-loader.js';
import { createExecutionOriginMetadata } from '../background-tasks/index.js';
import { storeSessionBackgroundTaskManager } from '../background-tasks/session-background-store.js';
import { buildSystemPrompt } from '../context/system-prompt-builder.js';
import { createInProcessSubagentRunner } from '../subagents/in-process-subagent-runner.js';
import { storeAgentToolDeps } from '../tools/agent-tool.js';
import { createBackgroundProcessTool } from '../tools/background-process-tool.js';
import { formatProjectedModelCommandToolPromptDescription } from '../tools/model-command-tool-projection.js';

import type { ICreateSessionOptions } from './create-session-types.js';
import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import type { IBackgroundTaskManager } from '../background-tasks/index.js';
import type { ICapabilityDescriptor } from '../capabilities/types.js';
import type { ISystemPromptParams } from '../context/system-prompt-builder.js';
import type { IAgentToolDeps } from '../tools/agent-tool.js';
import type { IBackgroundProcessToolDeps } from '../tools/background-process-tool.js';
import type { createModelCommandToolProjection } from '../tools/model-command-tool-projection.js';
import type { IAIProvider, IToolWithEventService, IHookTypeExecutor } from '@robota-sdk/agent-core';
import type { TBackgroundTaskEvent } from '@robota-sdk/agent-interface-transport';
import type { ISessionLogger } from '@robota-sdk/agent-session';
import type { Session } from '@robota-sdk/agent-session';

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
  rebuildSystemMessage: (
    agentsMd: string,
    claudeMd: string,
    overrides?: { persona?: string; selfVerification?: boolean },
  ) => string;
}

/**
 * Build the static system-prompt params shared by the initial build and every rebuild. Persona
 * (PRESET-014) and selfVerification (PRESET-017) are composed separately per-build so their mutable
 * closure values always take precedence over these static params.
 */
function buildStaticPromptParams(
  options: ICreateSessionOptions,
  cwd: string,
  resolvedToolDescriptions: string[],
  modelVisibleSkills: Array<{
    name: string;
    description: string;
    disableModelInvocation?: boolean;
  }>,
  agentDefinitions: IAgentDefinition[],
): Omit<ISystemPromptParams, 'persona' | 'selfVerification'> {
  return {
    agentsMd: options.context.agentsMd,
    claudeMd: options.context.claudeMd,
    memoryMd: options.context.memoryMd,
    taskContext: options.context.taskContext,
    toolDescriptions: resolvedToolDescriptions,
    // CLI-072: the prompt names the mode the gate enforces — same resolution
    // as agent-session (explicit mode, else trust-level mapping, else default).
    permissionMode:
      options.permissionMode ?? TRUST_TO_MODE[options.config.defaultTrustLevel] ?? 'default',
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

  // PRESET-014: persona is mutable for the lifetime of this closure. A live preset switch can
  // re-apply a new persona mid-session (via `rebuildSystemMessage(..., { persona })`); later
  // staleness rebuilds (no override) must keep the most recently applied persona.
  let currentPersona = options.persona;

  // PRESET-017: selfVerification is mutable for the lifetime of this closure, mirroring persona. A
  // live preset switch can toggle the verify-before-done section mid-session (via
  // `rebuildSystemMessage(..., { selfVerification })`); later staleness rebuilds (no override) must
  // keep the most recently applied value.
  let currentSelfVerification = options.selfVerification;

  // Persona/selfVerification are composed per-build (initial + each rebuild) so the mutable closure
  // values always win; they are therefore excluded from these static params.
  const staticPromptParams = buildStaticPromptParams(
    options,
    cwd,
    resolvedToolDescriptions,
    modelVisibleSkills,
    agentDefinitions,
  );
  const systemMessage = buildPrompt({
    ...staticPromptParams,
    ...(currentPersona !== undefined ? { persona: currentPersona } : {}),
    ...(currentSelfVerification !== undefined ? { selfVerification: currentSelfVerification } : {}),
  });
  const finalSystemMessage = options.appendSystemPrompt
    ? `${systemMessage}\n\n${options.appendSystemPrompt}`
    : systemMessage;

  const rebuildSystemMessage = (
    newAgentsMd: string,
    newClaudeMd: string,
    overrides?: { persona?: string; selfVerification?: boolean },
  ): string => {
    // PRESET-014: a persona override mutates the retained persona so subsequent rebuilds
    // (e.g. staleness refresh, which passes no override) keep the latest applied persona.
    if (overrides?.persona !== undefined) {
      currentPersona = overrides.persona;
    }
    // PRESET-017: a selfVerification override mutates the retained flag the same way, so later
    // override-less rebuilds keep the latest applied value.
    if (overrides?.selfVerification !== undefined) {
      currentSelfVerification = overrides.selfVerification;
    }
    const rebuilt = buildPrompt({
      ...staticPromptParams,
      ...(currentPersona !== undefined ? { persona: currentPersona } : {}),
      ...(currentSelfVerification !== undefined
        ? { selfVerification: currentSelfVerification }
        : {}),
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
  // PRESET-016: wire the runtime gate to the session's live flag so a preset switch can
  // enable/disable subagent dispatch on this already-constructed session.
  if (agentToolDeps) {
    agentToolDeps.isParallelSubagentsEnabled = () => session.getParallelSubagentsEnabled();
  }
  if (backgroundProcessToolDeps) backgroundProcessToolDeps.parentSessionId = session.getSessionId();
  storeSessionBackgroundTaskManager(session, backgroundTaskManager);
  if (agentToolDeps) storeAgentToolDeps(session, agentToolDeps);
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
