/**
 * Session initialization helpers for InteractiveSession.
 *
 * Handles async config/context loading, plugin merging, and session creation.
 * Option interfaces live in interactive-session-options.ts.
 * Session restore logic lives in interactive-session-restore.ts.
 */

import { createSession } from '../assembly/index.js';
import type { IContextFileEntry } from '../context/context-loader.js';
import { FileSessionLogger } from '@robota-sdk/agent-sessions';
import type { Session } from '@robota-sdk/agent-sessions';
import type { ICompactEvent } from '@robota-sdk/agent-sessions';
import type { IContextWindowState, TToolArgs, TUniversalMessage } from '@robota-sdk/agent-core';
import { projectPaths } from '../paths.js';
import { loadConfig } from '../config/config-loader.js';
import type { IResolvedConfig } from '../config/config-types.js';
import { loadContext } from '../context/context-loader.js';
import { detectProject } from '../context/project-detector.js';
import { BundlePluginLoader } from '../plugins/index.js';
import { mergePluginHooks, mergeHooksIntoConfig } from '../plugins/plugin-hooks-merger.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NOOP_TERMINAL } from './interactive-session-execution.js';
import { applyWorkspaceManifest } from '@robota-sdk/agent-tools';
import type { ICommandResult } from '../commands/index.js';
import type { ICapabilityDescriptor } from '../capabilities/types.js';
import type {
  IInteractiveSessionStandardOptions,
  IInitOptions,
} from './interactive-session-options.js';
import { injectSavedMessage } from './interactive-session-restore.js';
import { EditCheckpointStore } from '../checkpoints/edit-checkpoint-store.js';

export type {
  IInteractiveSessionStandardOptions,
  IInteractiveSessionInjectedOptions,
  IInteractiveSessionOptions,
  IInitOptions,
} from './interactive-session-options.js';
export { injectSavedMessage, loadSessionRecord } from './interactive-session-restore.js';

/** Return value of createInteractiveSession — session plus staleness tracking data. */
export interface ICreatedInteractiveSession {
  session: Session;
  /** Per-file entries for AGENTS.md files loaded at startup. Used for staleness detection. */
  agentsFileEntries: IContextFileEntry[];
  /** Per-file entries for CLAUDE.md files loaded at startup. Used for staleness detection. */
  claudeFileEntries: IContextFileEntry[];
  /** Rebuilds the system message given updated agentsMd and claudeMd strings. */
  rebuildSystemMessage: (agentsMd: string, claudeMd: string) => string;
}

/**
 * Create and return a fully initialized Session.
 *
 * Loads config, context, project info in parallel, merges plugin hooks,
 * then constructs the session via createSession().
 */
export async function createInteractiveSession(
  options: IInitOptions,
): Promise<ICreatedInteractiveSession> {
  const cwd = options.cwd;
  const [config, context, projectInfo] = await Promise.all([
    options.config ? Promise.resolve(options.config) : loadConfig(cwd),
    options.bare
      ? Promise.resolve({
          agentsMd: '',
          claudeMd: '',
          agentsFileEntries: [],
          claudeFileEntries: [],
        })
      : loadContext(cwd),
    options.bare
      ? Promise.resolve({ type: 'unknown' as const, language: 'unknown' as const })
      : detectProject(cwd),
  ]);

  let mergedConfig: IResolvedConfig = options.language
    ? { ...config, language: options.language }
    : config;

  const pluginsDir = join(homedir(), '.robota', 'plugins');
  const pluginLoader = new BundlePluginLoader(pluginsDir);
  if (!options.bare) {
    try {
      const plugins = pluginLoader.loadPluginsSync();
      if (plugins.length > 0) {
        const pluginHooks = mergePluginHooks(plugins);
        mergedConfig = {
          ...mergedConfig,
          hooks: mergeHooksIntoConfig(
            mergedConfig.hooks as Record<string, Array<Record<string, unknown>>> | undefined,
            pluginHooks as Record<string, Array<Record<string, unknown>>>,
          ),
        };
      }
    } catch {
      // No plugins dir or load failed
    }
  }

  const paths = projectPaths(cwd);

  const sandboxRestored = await restoreInteractiveSandboxSnapshot(options);
  if (!sandboxRestored) {
    await applyInteractiveWorkspaceManifest(options, cwd);
  }

  const sessionId =
    options.resumeSessionId && !options.forkSession ? options.resumeSessionId : undefined;

  const { session, rebuildSystemMessage } = createSession({
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
    reversibleExecution: options.reversibleExecution,
    sandboxClient: options.sandboxClient,
  });

  return {
    session,
    agentsFileEntries: context.agentsFileEntries ?? [],
    claudeFileEntries: context.claudeFileEntries ?? [],
    rebuildSystemMessage,
  };
}

async function applyInteractiveWorkspaceManifest(
  options: IInitOptions,
  cwd: string,
): Promise<void> {
  if (!options.workspaceManifest) return;
  if (!options.sandboxClient) {
    throw new Error('workspaceManifest requires sandboxClient.');
  }
  await applyWorkspaceManifest(options.sandboxClient, options.workspaceManifest, {
    hostRoot: cwd,
    ...(options.sandboxWorkspaceRoot ? { targetRoot: options.sandboxWorkspaceRoot } : {}),
  });
}

async function restoreInteractiveSandboxSnapshot(options: IInitOptions): Promise<boolean> {
  if (!options.sandboxSnapshotId) return false;
  if (!options.sandboxClient?.restore) {
    throw new Error('sandboxSnapshotId requires sandboxClient with restore().');
  }
  await options.sandboxClient.restore(options.sandboxSnapshotId);
  return true;
}

/** Dependencies injected into initializeInteractiveSessionAsync from the class. */
export interface IAsyncInitDeps {
  /** Currently stored sandbox snapshot ID (may be set by restore). */
  sandboxSnapshotId: string | undefined;
  /** Session ID to resume (may be set by restore). */
  resumeSessionId: string | undefined;
  /** Messages deferred until the session is created (set during restore). */
  pendingRestoreMessages: TUniversalMessage[] | null;
  /** Callbacks for handling events during initialization. */
  onTextDelta: (delta: string) => void;
  onContextUpdate: (state: IContextWindowState) => void;
  onCompactEvent: (event: ICompactEvent) => void;
  onToolExecution: (event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
    success?: boolean;
    denied?: boolean;
    toolResultData?: string;
  }) => void;
  executeModelCommand: (command: string, args: string) => Promise<ICommandResult | null>;
  isModelCommandInvocable: (command: string) => boolean;
  commandDescriptors: readonly ICapabilityDescriptor[];
  setEditCheckpointStore: (store: EditCheckpointStore) => void;
}

/** Result returned from initializeInteractiveSessionAsync. */
export interface IAsyncInitResult {
  session: Session;
  agentsFileEntries: IContextFileEntry[];
  claudeFileEntries: IContextFileEntry[];
  rebuildSystemMessage: ICreatedInteractiveSession['rebuildSystemMessage'];
  autoCompactThresholdSource: 'default' | 'settings';
}

/**
 * Async initialization flow extracted from InteractiveSession.initializeAsync.
 *
 * Loads config, creates the session, injects pending restore messages, and
 * returns the initialized session plus metadata. The caller is responsible
 * for wiring the result back into the class (bgTracker.subscribe, persist, etc.).
 */
export async function initializeInteractiveSessionAsync(
  options: IInteractiveSessionStandardOptions,
  deps: IAsyncInitDeps,
): Promise<IAsyncInitResult> {
  const config = options.config ?? (await loadConfig(options.cwd));
  const autoCompactThresholdSource =
    config.autoCompactThreshold === undefined ? 'default' : 'settings';
  const checkpointStore = new EditCheckpointStore({ cwd: options.cwd });
  deps.setEditCheckpointStore(checkpointStore);

  const created = await createInteractiveSession({
    cwd: options.cwd,
    provider: options.provider,
    config,
    permissionMode: options.permissionMode,
    maxTurns: options.maxTurns,
    permissionHandler: options.permissionHandler,
    resumeSessionId: deps.resumeSessionId,
    forkSession: options.forkSession,
    onTextDelta: deps.onTextDelta,
    onContextUpdate: deps.onContextUpdate,
    onCompactEvent: deps.onCompactEvent,
    onToolExecution: deps.onToolExecution,
    bare: options.bare,
    allowedTools: options.allowedTools,
    appendSystemPrompt: options.appendSystemPrompt,
    language: options.language,
    backgroundTaskRunners: options.backgroundTaskRunners,
    subagentRunnerFactory: options.subagentRunnerFactory,
    ...(options.commandModules ? { commandModules: options.commandModules } : {}),
    editCheckpointRecorder: checkpointStore,
    ...(options.reversibleExecution ? { reversibleExecution: options.reversibleExecution } : {}),
    ...(options.sandboxClient ? { sandboxClient: options.sandboxClient } : {}),
    ...(options.workspaceManifest ? { workspaceManifest: options.workspaceManifest } : {}),
    ...(options.sandboxWorkspaceRoot ? { sandboxWorkspaceRoot: options.sandboxWorkspaceRoot } : {}),
    ...(deps.sandboxSnapshotId ? { sandboxSnapshotId: deps.sandboxSnapshotId } : {}),
    commandDescriptors: deps.commandDescriptors,
    ...(deps.commandDescriptors.length > 0
      ? {
          modelCommandExecutor: deps.executeModelCommand,
          isModelCommandInvocable: deps.isModelCommandInvocable,
        }
      : {}),
  });

  if (deps.pendingRestoreMessages) {
    for (const msg of deps.pendingRestoreMessages) injectSavedMessage(created.session, msg);
  }

  return {
    session: created.session,
    agentsFileEntries: created.agentsFileEntries,
    claudeFileEntries: created.claudeFileEntries,
    rebuildSystemMessage: created.rebuildSystemMessage,
    autoCompactThresholdSource,
  };
}
