/**
 * Session factory — assembles a fully-configured Session from config, context,
 * tools, and provider.
 *
 * This is the main entry point for creating sessions. It wires together
 * the provider, tools, system prompt, and configuration that Session now
 * expects as pre-constructed dependencies.
 */

import type {
  IAIProvider,
  IContextWindowState,
  IToolWithEventService,
  IHookTypeExecutor,
} from '@robota-sdk/agent-core';
import type { TPermissionMode, TToolArgs } from '@robota-sdk/agent-core';
import { PromptExecutor } from '../hooks/prompt-executor.js';
import { AgentExecutor } from '../hooks/agent-executor.js';
import type { TProviderFactory } from '../hooks/prompt-executor.js';
import type { TSessionFactory } from '../hooks/agent-executor.js';
import { Session } from '@robota-sdk/agent-sessions';
import type {
  ITerminalOutput,
  ICompactEvent,
  ISessionOptions,
  TPermissionHandler,
  ISessionLogger,
} from '@robota-sdk/agent-sessions';
import type { IResolvedConfig } from '../config/config-types.js';
import type { ILoadedContext } from '../context/context-loader.js';
import type { IProjectInfo } from '../context/project-detector.js';
import { buildSystemPrompt } from '../context/system-prompt-builder.js';
import type { ISystemPromptParams } from '../context/system-prompt-builder.js';
import { createDefaultTools, DEFAULT_TOOL_DESCRIPTIONS } from './create-tools.js';

import {
  createAgentTool,
  createAgentToolPromptDescription,
  storeAgentToolDeps,
} from '../tools/agent-tool.js';
import type { IAgentToolDeps } from '../tools/agent-tool.js';
import { createBackgroundProcessTool } from '../tools/background-process-tool.js';
import type { IBackgroundProcessToolDeps } from '../tools/background-process-tool.js';
import { createCommandExecutionTool } from '../tools/command-execution-tool.js';
import type { ICommandResult } from '../commands/system-command.js';
import type { ICapabilityDescriptor } from '../capabilities/types.js';
import { wrapEditCheckpointTools } from '../checkpoints/edit-checkpoint-tools.js';
import type { IEditCheckpointRecorder } from '../checkpoints/edit-checkpoint-types.js';
import { wrapReversibleExecutionTools } from '../reversible-execution/index.js';
import type { IReversibleExecutionOptions } from '../reversible-execution/index.js';
import { BackgroundTaskManager, SubagentManager } from '@robota-sdk/agent-runtime';
import { createInProcessSubagentRunner } from '../subagents/in-process-subagent-runner.js';
import type { TSubagentRunnerFactory } from '../subagents/in-process-subagent-runner.js';
import type { IInteractiveSessionStore } from '../interactive/session-persistence.js';
import { AgentDefinitionLoader } from '../agents/agent-definition-loader.js';
import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import { SkillCommandSource } from '../commands/skill-source.js';
import { fireSubagentLifecycleHook } from './background-task-hooks.js';
import type {
  IBackgroundTaskManager,
  IBackgroundTaskRunner,
  TBackgroundTaskEvent,
} from '../background-tasks/index.js';
import { storeSessionBackgroundTaskManager } from '../background-tasks/session-background-store.js';

const ID_RADIX = 36;
const ID_RANDOM_LENGTH = 9;
const DEFAULT_PROVIDER_IDLE_TIMEOUT_MS = 120_000;

type TAutoCompactThreshold = number | false;
type TSessionOptionsWithAutoCompact = ISessionOptions & {
  autoCompactThreshold?: TAutoCompactThreshold;
};
type TSessionConstructorWithAutoCompact = new (options: TSessionOptionsWithAutoCompact) => Session;

/** Options for the createSession factory */
export interface ICreateSessionOptions {
  /** Resolved CLI configuration (model, API key, permissions) */
  config: IResolvedConfig;
  /** Working directory used for project context, skills, and agent definitions. */
  cwd?: string;
  /** Loaded AGENTS.md / CLAUDE.md context */
  context: ILoadedContext;
  /** Terminal I/O for permission prompts */
  terminal: ITerminalOutput;
  /** Project metadata for system prompt */
  projectInfo?: IProjectInfo;
  /** Initial permission mode (defaults to config.defaultTrustLevel → mode mapping) */
  permissionMode?: TPermissionMode;
  /** Maximum number of agentic turns per run() call. Undefined = unlimited. */
  maxTurns?: number;
  /** Optional session store for persistence */
  sessionStore?: IInteractiveSessionStore;
  /** Inject a pre-constructed AI provider (used by tests to avoid real API calls) */
  provider?: IAIProvider;
  /** Custom permission handler (overrides terminal-based prompts, used by Ink UI) */
  permissionHandler?: TPermissionHandler;
  /** Callback for text deltas — enables streaming text to the UI in real-time */
  onTextDelta?: (delta: string) => void;
  /** Callback when context window usage is refreshed */
  onContextUpdate?: (state: IContextWindowState) => void;
  /** Custom prompt-for-approval function (injected from CLI) */
  promptForApproval?: (
    terminal: ITerminalOutput,
    toolName: string,
    toolArgs: TToolArgs,
  ) => Promise<boolean>;
  /** Additional tools to register beyond the defaults (e.g. agent-tool) */
  additionalTools?: IToolWithEventService[];
  /** Additional background task runners composed by the runtime shell. */
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  /** Runtime shell override for subagent execution. Defaults to the SDK in-process runner. */
  subagentRunnerFactory?: TSubagentRunnerFactory;
  /** Enable agent tool, agent definitions, and subagent runtime wiring for this session. */
  enableAgentRuntime?: boolean;
  /** Callback when a tool starts or finishes execution — enables real-time tool display in UI */
  onToolExecution?: (event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
    success?: boolean;
    denied?: boolean;
    toolResultData?: string;
  }) => void;
  /** Callback when context is compacted */
  onCompact?: (summary: string) => void;
  /** Callback with structured compaction metadata */
  onCompactEvent?: (event: ICompactEvent) => void;
  /** Instructions to include in the compaction prompt (e.g. from CLAUDE.md) */
  compactInstructions?: string;
  /** Auto-compact threshold as a 0-1 fraction. Set false to disable automatic compaction. */
  autoCompactThreshold?: TAutoCompactThreshold;
  /** Custom system prompt builder function */
  systemPromptBuilder?: (params: ISystemPromptParams) => string;
  /** Custom tool descriptions for the system prompt */
  toolDescriptions?: string[];
  /** Session logger — injected for pluggable session event logging. */
  sessionLogger?: ISessionLogger;
  /** Provider factory for prompt hook executors (DI). */
  providerFactory?: TProviderFactory;
  /** Session factory for agent hook executors (DI). */
  sessionFactory?: TSessionFactory;
  /** Additional hook type executors beyond the defaults (prompt, agent). */
  additionalHookExecutors?: IHookTypeExecutor[];
  /** Override session ID (used when resuming a session to reuse the original ID) */
  sessionId?: string;
  /** Pre-approved tool names — added to permissions.allow as ToolName(*) patterns. */
  allowedTools?: string[];
  /** Text to append to the generated system prompt. */
  appendSystemPrompt?: string;
  /** Model command execution bridge. */
  modelCommandExecutor?: (command: string, args: string) => Promise<ICommandResult | null>;
  /** Predicate for commands allowed through the model command execution bridge. */
  isModelCommandInvocable?: (command: string) => boolean;
  /** Model-visible command descriptors. */
  commandDescriptors?: ICapabilityDescriptor[];
  /** Recorder used to snapshot files before Write/Edit tools mutate them. */
  editCheckpointRecorder?: IEditCheckpointRecorder;
  /** Opt-in local-first reversible execution policy for write/shell tools. */
  reversibleExecution?: IReversibleExecutionOptions;
}

/**
 * Create a fully-configured Session instance.
 *
 * Assembles provider, tools, and system prompt, then passes them
 * to Session as pre-constructed dependencies.
 */
export function createSession(options: ICreateSessionOptions): Session {
  if (!options.provider) {
    throw new Error(
      'provider is required. SDK is provider-neutral — consumer must create and pass a provider instance.',
    );
  }
  const provider = options.provider;
  const cwd = options.cwd ?? process.cwd();
  const sessionId = options.sessionId ?? createSessionId();

  const defaultTools = options.editCheckpointRecorder
    ? wrapEditCheckpointTools(createDefaultTools(), options.editCheckpointRecorder)
    : createDefaultTools();
  const assembledTools = [...defaultTools, ...(options.additionalTools ?? [])];
  const tools = options.reversibleExecution
    ? wrapReversibleExecutionTools(assembledTools, {
        ...options.reversibleExecution,
        checkpointAvailable: options.editCheckpointRecorder !== undefined,
      })
    : assembledTools;
  if (options.modelCommandExecutor && options.isModelCommandInvocable) {
    tools.push(
      createCommandExecutionTool({
        execute: options.modelCommandExecutor,
        isModelInvocable: options.isModelCommandInvocable,
      }),
    );
  }

  // Build hook type executors early so they can be forwarded to subagents.
  const hookTypeExecutors: IHookTypeExecutor[] = [];
  if (options.providerFactory) {
    hookTypeExecutors.push(
      new PromptExecutor({
        providerFactory: options.providerFactory,
        defaultModel: options.config.provider.model,
      }),
    );
  }
  if (options.sessionFactory) {
    hookTypeExecutors.push(
      new AgentExecutor({
        sessionFactory: options.sessionFactory,
      }),
    );
  }
  if (options.additionalHookExecutors) {
    hookTypeExecutors.push(...options.additionalHookExecutors);
  }

  let agentToolDeps: IAgentToolDeps | undefined;
  let agentDefinitions: IAgentDefinition[] = [];
  let backgroundTaskManager: IBackgroundTaskManager | undefined;

  if (options.enableAgentRuntime) {
    // Wire agent tool only when the caller composes the agent capability module.
    // Must happen after default tools are assembled so sub-agents inherit the full set.
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
  if (backgroundTaskManager && sessionLogger) {
    backgroundTaskManager.subscribe((event) =>
      logBackgroundTaskEvent(sessionLogger, sessionId, event),
    );
  }
  if (backgroundTaskManager) {
    backgroundTaskManager.subscribe((event) =>
      fireSubagentLifecycleHook(
        event,
        cwd,
        options.config.hooks,
        hookTypeExecutors.length > 0 ? hookTypeExecutors : undefined,
      ),
    );
  }

  let backgroundProcessToolDeps: IBackgroundProcessToolDeps | undefined;
  if (
    backgroundTaskManager &&
    options.backgroundTaskRunners?.some((runner) => runner.kind === 'process')
  ) {
    backgroundProcessToolDeps = {
      backgroundTaskManager,
      cwd,
      parentSessionId: sessionId,
    };
    tools.push(createBackgroundProcessTool(backgroundProcessToolDeps));
  }
  if (agentToolDeps) {
    tools.push(createAgentTool(agentToolDeps));
  }

  const buildPrompt = options.systemPromptBuilder ?? buildSystemPrompt;
  const defaultToolDescriptions = [
    ...DEFAULT_TOOL_DESCRIPTIONS,
    ...(agentToolDeps ? [createAgentToolPromptDescription(agentDefinitions)] : []),
    ...(options.modelCommandExecutor
      ? ['ExecuteCommand — execute model-invocable Robota commands']
      : []),
  ];
  const systemMessage = buildPrompt({
    agentsMd: options.context.agentsMd,
    claudeMd: options.context.claudeMd,
    memoryMd: options.context.memoryMd,
    taskContext: options.context.taskContext,
    toolDescriptions:
      options.toolDescriptions ??
      (backgroundProcessToolDeps
        ? [
            ...defaultToolDescriptions,
            'BackgroundProcess — start long-running shell commands as managed background tasks',
          ]
        : defaultToolDescriptions),
    trustLevel: options.config.defaultTrustLevel,
    projectInfo: options.projectInfo ?? { type: 'unknown', language: 'unknown' },
    cwd,
    language: options.config.language,
    skills: new SkillCommandSource(cwd).getModelInvocableSkills().map((skill) => ({
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
  });
  const finalSystemMessage = options.appendSystemPrompt
    ? `${systemMessage}\n\n${options.appendSystemPrompt}`
    : systemMessage;

  // Merge default allow patterns for config folders with user-configured permissions
  const defaultAllow = [
    'Read(.agents/**)',
    'Read(.claude/**)',
    'Read(.robota/**)',
    'Glob(.agents/**)',
    'Glob(.claude/**)',
    'Glob(.robota/**)',
  ];
  const allowedToolPatterns = (options.allowedTools ?? []).map((name) => `${name}(*)`);
  const mergedPermissions = {
    allow: [...defaultAllow, ...(options.config.permissions.allow ?? []), ...allowedToolPatterns],
    deny: options.config.permissions.deny ?? [],
  };

  const SessionWithAutoCompact = Session as TSessionConstructorWithAutoCompact;
  const session = new SessionWithAutoCompact({
    tools,
    provider,
    systemMessage: finalSystemMessage,
    terminal: options.terminal,
    permissions: mergedPermissions,
    hooks: options.config.hooks,
    permissionMode: options.permissionMode,
    defaultTrustLevel: options.config.defaultTrustLevel,
    model: options.config.provider.model,
    providerTimeout: options.config.provider.timeout ?? DEFAULT_PROVIDER_IDLE_TIMEOUT_MS,
    maxTurns: options.maxTurns,
    sessionStore: options.sessionStore,
    sessionId,
    permissionHandler: options.permissionHandler,
    onTextDelta: options.onTextDelta,
    onContextUpdate: options.onContextUpdate,
    onToolExecution: options.onToolExecution,
    promptForApproval: options.promptForApproval,
    onCompact: options.onCompact,
    onCompactEvent: options.onCompactEvent,
    compactInstructions: options.compactInstructions ?? options.context.compactInstructions,
    autoCompactThreshold: options.autoCompactThreshold ?? options.config.autoCompactThreshold,
    sessionLogger: options.sessionLogger,
    hookTypeExecutors: hookTypeExecutors.length > 0 ? hookTypeExecutors : undefined,
  });

  // Store deps keyed by session so consumers (e.g. fork runner) can retrieve
  // per-session deps without relying on global mutable state.
  if (agentToolDeps) agentToolDeps.parentSessionId = session.getSessionId();
  if (backgroundProcessToolDeps) backgroundProcessToolDeps.parentSessionId = session.getSessionId();
  if (backgroundTaskManager) storeSessionBackgroundTaskManager(session, backgroundTaskManager);
  if (agentToolDeps) storeAgentToolDeps(session, agentToolDeps);

  return session;
}

function createSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(ID_RADIX).substr(2, ID_RANDOM_LENGTH)}`;
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
