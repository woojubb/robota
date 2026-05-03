/**
 * Session initialization helpers for InteractiveSession.
 *
 * Handles async config/context loading, plugin merging, and session creation.
 * Also provides session-restore (resume/fork) logic.
 */

import { createSession } from '../assembly/index.js';
import type { ICreateSessionOptions } from '../assembly/index.js';
import { FileSessionLogger } from '@robota-sdk/agent-sessions';
import type { Session } from '@robota-sdk/agent-sessions';
import type { ICompactEvent } from '@robota-sdk/agent-sessions';
import type { SessionStore } from '@robota-sdk/agent-sessions';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { IContextWindowState } from '@robota-sdk/agent-core';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { TToolArgs } from '@robota-sdk/agent-core';
import type {
  IBackgroundJobGroupState,
  IBackgroundTaskRunner,
  IBackgroundTaskState,
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
  TBackgroundTaskStatus,
} from '../background-tasks/index.js';
import type { TSubagentRunnerFactory } from '../subagents/index.js';
import type { ICommandHostAdapters, ICommandModule, ICommandResult } from '../commands/index.js';
import type { ICapabilityDescriptor } from '../capabilities/types.js';
import { projectPaths } from '../paths.js';
import { loadConfig } from '../config/config-loader.js';
import type { IResolvedConfig } from '../config/config-types.js';
import { loadContext } from '../context/context-loader.js';
import { detectProject } from '../context/project-detector.js';
import { BundlePluginLoader } from '../plugins/index.js';
import { mergePluginHooks, mergeHooksIntoConfig } from '../plugins/plugin-hooks-merger.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TInteractivePermissionHandler } from './types.js';
import { NOOP_TERMINAL } from './interactive-session-execution.js';
import type { IMemoryEvent, IMemoryReference } from '../memory/automatic-memory-types.js';
import type { IEditCheckpointRecorder } from '../checkpoints/edit-checkpoint-types.js';

/** Standard construction: cwd + provider. Config/context loaded internally. */
export interface IInteractiveSessionStandardOptions {
  cwd: string;
  provider: IAIProvider;
  permissionMode?: ICreateSessionOptions['permissionMode'];
  maxTurns?: number;
  permissionHandler?: TInteractivePermissionHandler;
  sessionStore?: SessionStore;
  sessionName?: string;
  resumeSessionId?: string;
  forkSession?: boolean;
  /** Skip AGENTS.md/CLAUDE.md loading and plugin discovery. */
  bare?: boolean;
  /** Pre-approved tool names passed to createSession. */
  allowedTools?: string[];
  /** Text to append to the system prompt. */
  appendSystemPrompt?: string;
  /** Runtime-composed background task runners. */
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  /** Runtime shell override for subagent execution. */
  subagentRunnerFactory?: TSubagentRunnerFactory;
  /** Optional command modules composed into this session. */
  commandModules?: readonly ICommandModule[];
  /** Host adapters available to composed command modules. */
  commandHostAdapters?: ICommandHostAdapters;
  /** Model-visible command descriptors derived from the composed command executor. */
  commandDescriptors?: readonly ICapabilityDescriptor[];
  /** Model command execution bridge. */
  modelCommandExecutor?: (command: string, args: string) => Promise<ICommandResult | null>;
  /** Predicate for commands allowed through the model command execution bridge. */
  isModelCommandInvocable?: (command: string) => boolean;
  /** Preloaded config to avoid duplicate discovery when caller needs it too. */
  config?: IResolvedConfig;
}

/** Test/advanced construction: inject pre-built session directly. */
export interface IInteractiveSessionInjectedOptions {
  session: Session;
  cwd?: string;
  provider?: IAIProvider;
  permissionMode?: ICreateSessionOptions['permissionMode'];
  maxTurns?: number;
  permissionHandler?: TInteractivePermissionHandler;
  sessionStore?: SessionStore;
  sessionName?: string;
  resumeSessionId?: string;
  forkSession?: boolean;
  /** Optional command modules composed into this injected session. */
  commandModules?: readonly ICommandModule[];
  /** Host adapters available to composed command modules. */
  commandHostAdapters?: ICommandHostAdapters;
}

/** Union of standard and injected construction options. */
export type IInteractiveSessionOptions =
  | IInteractiveSessionStandardOptions
  | IInteractiveSessionInjectedOptions;

/** Internal async init options (not re-exported). */
export interface IInitOptions {
  cwd: string;
  provider: IAIProvider;
  permissionMode?: ICreateSessionOptions['permissionMode'];
  maxTurns?: number;
  permissionHandler?: TInteractivePermissionHandler;
  resumeSessionId?: string;
  forkSession?: boolean;
  onTextDelta: (delta: string) => void;
  onContextUpdate?: (state: IContextWindowState) => void;
  onCompactEvent?: (event: ICompactEvent) => void;
  onToolExecution: (event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
    success?: boolean;
    denied?: boolean;
    toolResultData?: string;
  }) => void;
  /** Skip AGENTS.md/CLAUDE.md loading and plugin discovery. */
  bare?: boolean;
  /** Pre-approved tool names passed to createSession. */
  allowedTools?: string[];
  /** Text to append to the system prompt. */
  appendSystemPrompt?: string;
  /** Runtime-composed background task runners. */
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  /** Runtime shell override for subagent execution. */
  subagentRunnerFactory?: TSubagentRunnerFactory;
  /** Optional command modules composed into this session. */
  commandModules?: readonly ICommandModule[];
  /** Model-visible command descriptors derived from the composed command executor. */
  commandDescriptors?: readonly ICapabilityDescriptor[];
  /** Model command execution bridge. */
  modelCommandExecutor?: (command: string, args: string) => Promise<ICommandResult | null>;
  /** Predicate for commands allowed through the model command execution bridge. */
  isModelCommandInvocable?: (command: string) => boolean;
  /** Preloaded config to avoid duplicate discovery when caller needs it too. */
  config?: IResolvedConfig;
  /** Recorder used to snapshot files before Write/Edit tools mutate them. */
  editCheckpointRecorder?: IEditCheckpointRecorder;
}

/**
 * Create and return a fully initialized Session.
 *
 * Loads config, context, project info in parallel, merges plugin hooks,
 * then constructs the session via createSession().
 */
export async function createInteractiveSession(options: IInitOptions): Promise<Session> {
  const cwd = options.cwd;
  const [config, context, projectInfo] = await Promise.all([
    options.config ? Promise.resolve(options.config) : loadConfig(cwd),
    options.bare ? Promise.resolve({ agentsMd: '', claudeMd: '' }) : loadContext(cwd),
    options.bare
      ? Promise.resolve({ type: 'unknown' as const, language: 'unknown' as const })
      : detectProject(cwd),
  ]);

  // Load plugin hooks and merge into config
  const pluginsDir = join(homedir(), '.robota', 'plugins');
  const pluginLoader = new BundlePluginLoader(pluginsDir);
  let mergedConfig = config;
  if (!options.bare) {
    try {
      const plugins = pluginLoader.loadPluginsSync();
      if (plugins.length > 0) {
        const pluginHooks = mergePluginHooks(plugins);
        mergedConfig = {
          ...config,
          hooks: mergeHooksIntoConfig(
            config.hooks as Record<string, Array<Record<string, unknown>>> | undefined,
            pluginHooks as Record<string, Array<Record<string, unknown>>>,
          ),
        };
      }
    } catch {
      // No plugins dir or load failed
    }
  }

  const paths = projectPaths(cwd);

  // For non-fork resume, reuse the original session ID so saves update the same file
  const sessionId =
    options.resumeSessionId && !options.forkSession ? options.resumeSessionId : undefined;

  return createSession({
    config: mergedConfig,
    cwd,
    context,
    projectInfo,
    permissionMode: options.permissionMode,
    maxTurns: options.maxTurns,
    terminal: NOOP_TERMINAL,
    sessionLogger: new FileSessionLogger(paths.logs),
    permissionHandler: options.permissionHandler,
    provider: options.provider,
    onTextDelta: options.onTextDelta,
    onContextUpdate: options.onContextUpdate,
    onCompactEvent: options.onCompactEvent,
    onToolExecution: options.onToolExecution,
    sessionId,
    allowedTools: options.allowedTools,
    appendSystemPrompt: options.appendSystemPrompt,
    backgroundTaskRunners: options.backgroundTaskRunners,
    subagentRunnerFactory: options.subagentRunnerFactory,
    ...(options.commandModules?.some((module) =>
      module.sessionRequirements?.includes('agent-runtime'),
    )
      ? { enableAgentRuntime: true }
      : {}),
    ...(options.commandModules || options.commandDescriptors
      ? {
          commandDescriptors: [
            ...(options.commandDescriptors ?? []),
            ...(options.commandModules?.flatMap((module) => module.commandDescriptors ?? []) ?? []),
          ],
        }
      : {}),
    modelCommandExecutor: options.modelCommandExecutor,
    isModelCommandInvocable: options.isModelCommandInvocable,
    editCheckpointRecorder: options.editCheckpointRecorder,
  });
}

/** Inject a saved message into a session, supporting all roles including 'tool'. */
export function injectSavedMessage(session: Session, msg: unknown): void {
  if (!msg || typeof msg !== 'object') return;
  const m = msg as Record<string, unknown>;
  if (!m.role || !m.content) return;
  const role = m.role as string;
  if (role === 'tool') {
    const toolCallId = (m.toolCallId as string) ?? '';
    const name = (m.name as string) ?? undefined;
    session.injectMessage('tool', m.content as string, { toolCallId, name });
  } else if (role === 'user' || role === 'assistant' || role === 'system') {
    session.injectMessage(role, m.content as string);
  }
}

/**
 * Restore session history and messages from a persisted session record.
 * Returns the loaded history and any pending messages that need injection once session is ready.
 */
export function loadSessionRecord(
  sessionStore: SessionStore,
  resumeSessionId: string,
  forkSession: boolean,
  existingSession: Session | null,
): {
  history: IHistoryEntry[];
  sessionName: string | undefined;
  pendingRestoreMessages: unknown[] | null;
  backgroundTasks: IBackgroundTaskState[];
  backgroundTaskEvents: TBackgroundTaskEvent[];
  backgroundJobGroups: IBackgroundJobGroupState[];
  backgroundJobGroupEvents: TBackgroundJobGroupEvent[];
  memoryEvents: IMemoryEvent[];
  usedMemoryReferences: IMemoryReference[];
} {
  const record = sessionStore.load(resumeSessionId);
  if (!record) {
    return {
      history: [],
      sessionName: undefined,
      pendingRestoreMessages: null,
      backgroundTasks: [],
      backgroundTaskEvents: [],
      backgroundJobGroups: [],
      backgroundJobGroupEvents: [],
      memoryEvents: [],
      usedMemoryReferences: [],
    };
  }

  const history = (record.history ?? []) as IHistoryEntry[];
  const restoredBackgroundTasks = (record.backgroundTasks ?? []) as IBackgroundTaskState[];
  const restoredBackgroundTaskEvents = (record.backgroundTaskEvents ??
    []) as TBackgroundTaskEvent[];
  const backgroundJobGroups = (record.backgroundJobGroups ?? []) as IBackgroundJobGroupState[];
  const backgroundJobGroupEvents = (record.backgroundJobGroupEvents ??
    []) as TBackgroundJobGroupEvent[];
  const memoryEvents = (record.memoryEvents ?? []) as IMemoryEvent[];
  const usedMemoryReferences = (record.usedMemoryReferences ?? []) as IMemoryReference[];
  const { backgroundTasks, backgroundTaskEvents } = reconcileRestoredBackgroundTasks(
    restoredBackgroundTasks,
    restoredBackgroundTaskEvents,
  );
  const sessionName = record.name;
  let pendingRestoreMessages: unknown[] | null = null;

  if (!forkSession && record.messages) {
    if (existingSession) {
      // Injected-session path: session is already available
      for (const msg of record.messages) {
        injectSavedMessage(existingSession, msg);
      }
    } else {
      // Standard path: session not yet created, defer injection
      pendingRestoreMessages = record.messages;
    }
  }

  return {
    history,
    sessionName,
    pendingRestoreMessages,
    backgroundTasks,
    backgroundTaskEvents,
    backgroundJobGroups,
    backgroundJobGroupEvents,
    memoryEvents,
    usedMemoryReferences,
  };
}

function reconcileRestoredBackgroundTasks(
  tasks: IBackgroundTaskState[],
  events: TBackgroundTaskEvent[],
): { backgroundTasks: IBackgroundTaskState[]; backgroundTaskEvents: TBackgroundTaskEvent[] } {
  const now = new Date().toISOString();
  const syntheticEvents: TBackgroundTaskEvent[] = [];
  const backgroundTasks = tasks.map((task) => {
    if (isRestoredTerminalStatus(task.status)) return task;
    const reconciled: IBackgroundTaskState = {
      ...task,
      status: 'failed',
      timeoutReason: 'stale_worker',
      error: {
        category: 'timeout',
        message: 'Restored background task is stale; worker cannot be reattached',
        recoverable: true,
      },
      unread: true,
      completedAt: now,
      updatedAt: now,
    };
    syntheticEvents.push({ type: 'background_task_failed', task: reconciled });
    return reconciled;
  });
  return {
    backgroundTasks,
    backgroundTaskEvents: [...events, ...syntheticEvents],
  };
}

function isRestoredTerminalStatus(status: TBackgroundTaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
