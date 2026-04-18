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
import type { SessionStore } from '@robota-sdk/agent-sessions';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import { projectPaths } from '../paths.js';
import { loadConfig } from '../config/config-loader.js';
import { loadContext } from '../context/context-loader.js';
import { detectProject } from '../context/project-detector.js';
import { BundlePluginLoader } from '../plugins/index.js';
import { mergePluginHooks, mergeHooksIntoConfig } from '../plugins/plugin-hooks-merger.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TInteractivePermissionHandler } from './types.js';
import { NOOP_TERMINAL } from './interactive-session-execution.js';

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
  onToolExecution: (event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: Record<string, unknown>;
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
    loadConfig(cwd),
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
    context,
    projectInfo,
    permissionMode: options.permissionMode,
    maxTurns: options.maxTurns,
    terminal: NOOP_TERMINAL,
    sessionLogger: new FileSessionLogger(paths.logs),
    permissionHandler: options.permissionHandler,
    provider: options.provider,
    onTextDelta: options.onTextDelta,
    onToolExecution: options.onToolExecution,
    sessionId,
    allowedTools: options.allowedTools,
    appendSystemPrompt: options.appendSystemPrompt,
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
} {
  const record = sessionStore.load(resumeSessionId);
  if (!record) {
    return { history: [], sessionName: undefined, pendingRestoreMessages: null };
  }

  const history = (record.history ?? []) as IHistoryEntry[];
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

  return { history, sessionName, pendingRestoreMessages };
}
