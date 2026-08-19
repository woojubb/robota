/**
 * Session initialization helpers for InteractiveSession.
 *
 * Handles async config/context loading, plugin merging, and session creation.
 * Option interfaces live in interactive-session-options.ts.
 * Session restore logic lives in interactive-session-restore.ts.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { createLogger } from '@robota-sdk/agent-core';

import { buildCreateSessionOptions } from './create-session-projection.js';
import { detectProject } from '../context/project-detector.js';
import { projectPaths } from '../paths.js';
import {
  applyInteractiveWorkspaceManifest,
  interactiveSandboxOptions,
  restoreInteractiveSandboxSnapshot,
} from './interactive-session-init-workspace.js';
import { injectSavedMessage } from './interactive-session-restore.js';
import { deriveContextCapacityHint } from '../assembly/context-capacity-hint.js';

const logger = createLogger('InteractiveSessionInit');
import { createSession } from '../assembly/index.js';
import { EditCheckpointStore } from '../checkpoints/edit-checkpoint-store.js';
import { loadConfig } from '../config/config-loader.js';
import { loadContext } from '../context/context-loader.js';
import { BundlePluginLoader } from '../plugins/index.js';
import { mergePluginHooks, mergeHooksIntoConfig } from '../plugins/plugin-hooks-merger.js';

import type {
  IInteractiveSessionStandardOptions,
  IInitOptions,
} from './interactive-session-options.js';
import type { ICapabilityDescriptor } from '../capabilities/types.js';
import type { ICommandResult } from '../commands/index.js';
import type { IResolvedConfig } from '../config/config-types.js';
import type { IContextFileEntry } from '../context/context-loader.js';
import type { IContextWindowState, TToolArgs, TUniversalMessage } from '@robota-sdk/agent-core';
import type { ICompactEvent } from '@robota-sdk/agent-interface-transport';
import type { Session } from '@robota-sdk/agent-session';

export type {
  IInteractiveSessionStandardOptions,
  IInteractiveSessionInjectedOptions,
  TInteractiveSessionOptions,
  IInitOptions,
} from './interactive-session-options.js';
export { injectSavedMessage, loadSessionRecord } from './interactive-session-restore.js';

/** Return value of createInteractiveSession — session plus staleness tracking data. */
export interface ICreatedInteractiveSession {
  session: Session;
  /** Per-file entries for AGENTS.md files loaded at startup. Used for staleness detection. */
  agentsFileEntries: IContextFileEntry[];
  /** Per-file entries for CLAUDE.md files loaded at startup. Used for staleness detection. */
  projectNotesFileEntries: IContextFileEntry[];
  /**
   * Rebuilds the system message given updated agentsMd and projectNotesMd strings. PRESET-014: an
   * optional `overrides.persona` re-applies a preset persona to the live prompt; PRESET-017: an
   * optional `overrides.selfVerification` toggles the verify-before-done section. Either override
   * is retained for subsequent (override-less) rebuilds.
   */
  rebuildSystemMessage: (
    agentsMd: string,
    projectNotesMd: string,
    overrides?: { persona?: string; selfVerification?: boolean | string },
  ) => string;
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
  // NEUT-004: config resolves FIRST so the settings-driven task-context toggle can gate the
  // context load; context and project detection still run in parallel with each other.
  const config = options.config ?? (await loadConfig(cwd));
  const [context, projectInfo] = await Promise.all([
    options.bare
      ? Promise.resolve({
          agentsMd: '',
          projectNotesMd: '',
          agentsFileEntries: [],
          projectNotesFileEntries: [],
        })
      : loadContext(
          cwd,
          options.memoryStore,
          config.taskContext ? { taskContext: config.taskContext } : {},
        ),
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
    } catch (error) {
      // allow-fallback: a plugin problem must not stop the session from starting. CORE-029: what it
      // must not do is stay invisible — the previous comment ("No plugins dir or load failed")
      // conflated a normal case with an error, and both produced identical silence, so a user whose
      // hooks stopped running had nothing to look at. The loader now reports and skips per plugin,
      // so reaching here at all means discovery itself failed.
      logger.warn('plugin discovery failed — no bundle plugin hooks are active this session', {
        pluginsDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const paths = projectPaths(cwd);

  const sandboxRestored = await restoreInteractiveSandboxSnapshot(options);
  if (!sandboxRestored) {
    await applyInteractiveWorkspaceManifest(options, cwd);
  }

  const sessionId =
    options.resumeSessionId && !options.forkSession ? options.resumeSessionId : undefined;

  // NEUT-005: the core hard-capacity notice is product-neutral; derive an actionable remediation
  // hint from THIS surface's registered command set (e.g. a `/compact` command) so the notice
  // regains a concrete next step without baking product vocabulary into the neutral core.
  const contextCapacityHint = deriveContextCapacityHint(
    options.commandSemanticRoles?.contextReduction,
  );

  const { session, rebuildSystemMessage } = await createSession(
    buildCreateSessionOptions(options, {
      mergedConfig,
      cwd,
      context,
      projectInfo,
      sessionId,
      logsDir: paths.logs,
      contextCapacityHint,
    }),
  );

  return {
    session,
    agentsFileEntries: context.agentsFileEntries ?? [],
    projectNotesFileEntries: context.projectNotesFileEntries ?? [],
    rebuildSystemMessage,
  };
}

/** Dependencies injected into initializeInteractiveSessionAsync from the class. */
export interface IAsyncInitDeps {
  /** Currently stored sandbox snapshot ID (may be set by restore). */
  sandboxSnapshotId: string | undefined;
  /** Session ID to resume (may be set by restore). */
  resumeSessionId: string | undefined;
  /** Messages deferred until the session is created (set during restore). */
  pendingRestoreMessages: TUniversalMessage[] | null;
  /** Registry-backed internal prompt handlers; never public InteractiveSession options. */
  permissionHandler: IInitOptions['permissionHandler'];
  askHandler: IInitOptions['askHandler'];
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
  commandSemanticRoles: IInitOptions['commandSemanticRoles'];
  setEditCheckpointStore: (store: EditCheckpointStore) => void;
}

/** Result returned from initializeInteractiveSessionAsync. */
export interface IAsyncInitResult {
  session: Session;
  agentsFileEntries: IContextFileEntry[];
  projectNotesFileEntries: IContextFileEntry[];
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
    permissionHandler: deps.permissionHandler,
    ...(deps.askHandler ? { askHandler: deps.askHandler } : {}),
    resumeSessionId: deps.resumeSessionId,
    forkSession: options.forkSession,
    onTextDelta: deps.onTextDelta,
    onContextUpdate: deps.onContextUpdate,
    onCompactEvent: deps.onCompactEvent,
    onToolExecution: deps.onToolExecution,
    bare: options.bare,
    allowedTools: options.allowedTools,
    deniedTools: options.deniedTools,
    model: options.model,
    ...(options.effort !== undefined ? { effort: options.effort } : {}),
    appendSystemPrompt: options.appendSystemPrompt,
    ...(options.persona !== undefined ? { persona: options.persona } : {}),
    ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
    language: options.language,
    backgroundTaskRunners: options.backgroundTaskRunners,
    subagentRunnerFactory: options.subagentRunnerFactory,
    // ARCH-005: composition-root-contributed subagent definitions (capability packs).
    ...(options.agentDefinitions ? { agentDefinitions: options.agentDefinitions } : {}),
    ...(options.commandModules ? { commandModules: options.commandModules } : {}),
    editCheckpointRecorder: checkpointStore,
    ...(options.reversibleExecution ? { reversibleExecution: options.reversibleExecution } : {}),
    ...interactiveSandboxOptions(options, deps.sandboxSnapshotId),
    ...(options.memoryStore ? { memoryStore: options.memoryStore } : {}),
    ...(options.agentName ? { agentName: options.agentName } : {}),
    ...(options.activePresetId !== undefined ? { activePresetId: options.activePresetId } : {}),
    ...(options.enableParallelSubagents !== undefined
      ? { enableParallelSubagents: options.enableParallelSubagents }
      : {}),
    ...(options.selfVerification !== undefined
      ? { selfVerification: options.selfVerification }
      : {}),
    ...(options.additionalTools ? { additionalTools: options.additionalTools } : {}),
    ...(options.defaultTools ? { defaultTools: options.defaultTools } : {}), // ARCH-006
    ...(options.responseFormat ? { responseFormat: options.responseFormat } : {}),
    // ARCH-013 S3: both extension ports; dropping either here is the defect this stage fixed.
    ...(options.guardrails ? { guardrails: options.guardrails } : {}),
    ...(options.retrievalAdapter ? { retrievalAdapter: options.retrievalAdapter } : {}),
    commandDescriptors: deps.commandDescriptors,
    ...(deps.commandSemanticRoles ? { commandSemanticRoles: deps.commandSemanticRoles } : {}),
    ...(deps.commandDescriptors.length > 0
      ? {
          modelCommandExecutor: deps.executeModelCommand,
          isModelCommandInvocable: deps.isModelCommandInvocable,
        }
      : {}),
  });

  if (deps.pendingRestoreMessages) {
    for (const msg of deps.pendingRestoreMessages) injectSavedMessage(created.session, msg);
    created.session.syncContextFromHistory();
  }

  return {
    session: created.session,
    agentsFileEntries: created.agentsFileEntries,
    projectNotesFileEntries: created.projectNotesFileEntries,
    rebuildSystemMessage: created.rebuildSystemMessage,
    autoCompactThresholdSource,
  };
}
