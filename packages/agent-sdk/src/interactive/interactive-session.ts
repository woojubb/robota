/**
 * InteractiveSession — the single entry point for all SDK consumers.
 *
 * Wraps Session (composition). Manages streaming text accumulation,
 * tool execution state tracking, prompt queuing, abort orchestration,
 * message history, and system command execution.
 *
 * Config/context loading is internal. Consumer provides cwd + provider.
 */

import { createSession } from '../assembly/index.js';
import type { ICreateSessionOptions } from '../assembly/index.js';
import { FileSessionLogger } from '@robota-sdk/agent-sessions';
import type { Session } from '@robota-sdk/agent-sessions';
import type { IAIProvider } from '@robota-sdk/agent-core';
import { projectPaths } from '../paths.js';
import { loadConfig } from '../config/config-loader.js';
import { loadContext } from '../context/context-loader.js';
import { detectProject } from '../context/project-detector.js';
import type { TUniversalMessage, IContextWindowState, TToolArgs } from '@robota-sdk/agent-core';
import {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createToolMessage,
} from '@robota-sdk/agent-core';
import { SystemCommandExecutor, createSystemCommands } from '../commands/system-command.js';
import { BundlePluginLoader } from '../plugins/index.js';
import { mergePluginHooks, mergeHooksIntoConfig } from '../plugins/plugin-hooks-merger.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  IToolState,
  IExecutionResult,
  IToolSummary,
  TInteractivePermissionHandler,
  TInteractiveEventName,
  IInteractiveSessionEvents,
} from './types.js';

/** Max chars to display from first tool argument. */
const TOOL_ARG_DISPLAY_MAX = 80;
const TAIL_KEEP = 30;
/** Max completed tools to keep in the activeTools array during a single response. */
const MAX_COMPLETED_TOOLS = 50;
/** Streaming text flush interval (ms) — ~60fps. */
const STREAMING_FLUSH_INTERVAL_MS = 16;

/** Standard construction: cwd + provider. Config/context loaded internally. */
interface IInteractiveSessionStandardOptions {
  cwd: string;
  provider: IAIProvider;
  permissionMode?: ICreateSessionOptions['permissionMode'];
  maxTurns?: number;
  permissionHandler?: TInteractivePermissionHandler;
}

/** Test/advanced construction: inject pre-built session directly. */
interface IInteractiveSessionInjectedOptions {
  session: Session;
  cwd?: string;
  provider?: IAIProvider;
  permissionMode?: ICreateSessionOptions['permissionMode'];
  maxTurns?: number;
  permissionHandler?: TInteractivePermissionHandler;
}

export type IInteractiveSessionOptions =
  | IInteractiveSessionStandardOptions
  | IInteractiveSessionInjectedOptions;

export class InteractiveSession {
  private session: Session | null = null;
  private readonly commandExecutor: SystemCommandExecutor;
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // Streaming state
  private streamingText = '';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  // Tool state
  private activeTools: IToolState[] = [];

  // Execution state
  private executing = false;
  private pendingPrompt: string | null = null;
  private pendingDisplayInput: string | undefined;
  private pendingRawInput: string | undefined;

  // Display messages (what clients render — not the raw session history)
  private messages: TUniversalMessage[] = [];

  constructor(options: IInteractiveSessionOptions) {
    this.commandExecutor = new SystemCommandExecutor(createSystemCommands());

    if ('session' in options && options.session) {
      this.session = options.session;
      this.initialized = true;
    } else {
      const stdOpts = options as IInteractiveSessionStandardOptions;
      this.initPromise = this.initializeAsync(stdOpts);
    }
  }

  private async initializeAsync(options: IInteractiveSessionStandardOptions): Promise<void> {
    const cwd = options.cwd;
    const [config, context, projectInfo] = await Promise.all([
      loadConfig(cwd),
      loadContext(cwd),
      detectProject(cwd),
    ]);

    // Load plugin hooks and merge into config
    const pluginsDir = join(homedir(), '.robota', 'plugins');
    const pluginLoader = new BundlePluginLoader(pluginsDir);
    let mergedConfig = config;
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

    const paths = projectPaths(cwd);

    this.session = createSession({
      config: mergedConfig,
      context,
      projectInfo,
      permissionMode: options.permissionMode,
      maxTurns: options.maxTurns,
      terminal: NOOP_TERMINAL,
      sessionLogger: new FileSessionLogger(paths.logs),
      permissionHandler: options.permissionHandler,
      provider: options.provider,
      onTextDelta: (delta: string) => this.handleTextDelta(delta),
      onToolExecution: (event) => this.handleToolExecution(event),
    });

    this.initialized = true;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) await this.initPromise;
  }

  private getSessionOrThrow(): Session {
    if (!this.session)
      throw new Error('InteractiveSession not initialized. Call submit() or await initialization.');
    return this.session;
  }

  // ── Event system ──────────────────────────────────────────────

  on<E extends TInteractiveEventName>(event: E, handler: IInteractiveSessionEvents[E]): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as (...args: unknown[]) => void);
  }

  off<E extends TInteractiveEventName>(event: E, handler: IInteractiveSessionEvents[E]): void {
    this.listeners.get(event)?.delete(handler as (...args: unknown[]) => void);
  }

  private emit<E extends TInteractiveEventName>(
    event: E,
    ...args: Parameters<IInteractiveSessionEvents[E]>
  ): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────

  /** Submit a prompt. Queues if already executing (max 1 queued). */
  async submit(input: string, displayInput?: string, rawInput?: string): Promise<void> {
    await this.ensureInitialized();
    if (this.executing) {
      this.pendingPrompt = input;
      this.pendingDisplayInput = displayInput;
      this.pendingRawInput = rawInput;
      return;
    }
    await this.executePrompt(input, displayInput, rawInput);
  }

  /** Execute a system command by name. Returns null if not found. */
  async executeCommand(
    name: string,
    args: string,
  ): Promise<{ message: string; success: boolean; data?: Record<string, unknown> } | null> {
    await this.ensureInitialized();
    return this.commandExecutor.execute(name, this, args);
  }

  /** Abort current execution and clear queue. */
  abort(): void {
    this.pendingPrompt = null;
    this.pendingDisplayInput = undefined;
    this.pendingRawInput = undefined;
    this.session?.abort();
  }

  /** Cancel queued prompt without aborting current execution. */
  cancelQueue(): void {
    this.pendingPrompt = null;
    this.pendingDisplayInput = undefined;
    this.pendingRawInput = undefined;
  }

  isExecuting(): boolean {
    return this.executing;
  }

  getPendingPrompt(): string | null {
    return this.pendingPrompt;
  }

  getMessages(): TUniversalMessage[] {
    return this.messages;
  }

  getStreamingText(): string {
    return this.streamingText;
  }

  getActiveTools(): IToolState[] {
    return this.activeTools;
  }

  getContextState(): IContextWindowState {
    return this.getSessionOrThrow().getContextState();
  }

  /** Access underlying Session. For advanced use / testing only. */
  getSession(): Session {
    return this.getSessionOrThrow();
  }

  // ── Execution ─────────────────────────────────────────────────

  private async executePrompt(
    input: string,
    displayInput?: string,
    rawInput?: string,
  ): Promise<void> {
    this.executing = true;
    this.clearStreaming();
    this.emit('thinking', true);
    this.messages.push(createUserMessage(displayInput ?? input));

    const historyBefore = this.getSessionOrThrow().getHistory().length;

    try {
      const response = await this.getSessionOrThrow().run(input, rawInput);
      this.flushStreaming();
      this.pushToolSummaryMessage();
      this.clearStreaming();

      const result = this.buildResult(response || '(empty response)', historyBefore);
      this.messages.push(createAssistantMessage(result.response));
      this.emit('complete', result);
      this.emit('context_update', this.getContextState());
    } catch (err) {
      this.flushStreaming();

      if (isAbortError(err)) {
        const result = this.buildInterruptedResult(historyBefore);
        this.pushToolSummaryMessage();
        this.clearStreaming();
        if (result.response) {
          this.messages.push(createAssistantMessage(result.response));
        }
        this.messages.push(createSystemMessage('Interrupted by user.'));
        this.emit('interrupted', result);
      } else {
        this.pushToolSummaryMessage();
        this.clearStreaming();
        const errMsg = err instanceof Error ? err.message : String(err);
        this.messages.push(createSystemMessage(`Error: ${errMsg}`));
        this.emit('error', err instanceof Error ? err : new Error(errMsg));
      }
    } finally {
      this.executing = false;
      this.emit('thinking', false);

      if (this.pendingPrompt) {
        const queued = this.pendingPrompt;
        const queuedDisplay = this.pendingDisplayInput;
        const queuedRaw = this.pendingRawInput;
        this.pendingPrompt = null;
        this.pendingDisplayInput = undefined;
        this.pendingRawInput = undefined;
        setTimeout(() => this.executePrompt(queued, queuedDisplay, queuedRaw), 0);
      }
    }
  }

  // ── Streaming callbacks ───────────────────────────────────────

  private handleTextDelta(delta: string): void {
    this.streamingText += delta;
    this.emit('text_delta', delta);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
      }, STREAMING_FLUSH_INTERVAL_MS);
    }
  }

  private handleToolExecution(event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: Record<string, unknown>;
    success?: boolean;
    denied?: boolean;
    toolResultData?: string;
  }): void {
    if (event.type === 'start') {
      const firstArg = extractFirstArg(event.toolArgs);
      const state: IToolState = { toolName: event.toolName, firstArg, isRunning: true };
      this.activeTools.push(state);
      this.emit('tool_start', state);
    } else {
      const result: IToolState['result'] = event.denied
        ? 'denied'
        : event.success === false
          ? 'error'
          : 'success';
      const idx = this.activeTools.findIndex((t) => t.toolName === event.toolName && t.isRunning);
      if (idx !== -1) {
        const finished: IToolState = { ...this.activeTools[idx]!, isRunning: false, result };
        this.activeTools[idx] = finished;
        this.trimCompletedTools();
        this.emit('tool_end', finished);
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

  /** Push tool execution summary into messages (before Robota response).
   *  Moves tool info from activeTools (real-time display) to messages (permanent display).
   *  After this, activeTools will be cleared by clearStreaming(). */
  private pushToolSummaryMessage(): void {
    if (this.activeTools.length === 0) return;
    const summary = this.activeTools
      .map((t) => {
        const status = t.isRunning
          ? '⟳'
          : t.result === 'success'
            ? '✓'
            : t.result === 'error'
              ? '✗'
              : '⊘';
        return `${status} ${t.toolName}${t.firstArg ? `(${t.firstArg})` : ''}`;
      })
      .join('\n');
    this.messages.push(
      createToolMessage(summary, {
        toolCallId: 'tool-summary',
        name: `${this.activeTools.length} tools`,
      }),
    );
  }

  private clearStreaming(): void {
    this.streamingText = '';
    this.activeTools = [];
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private flushStreaming(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private buildResult(response: string, historyBefore: number): IExecutionResult {
    const toolSummaries = this.extractToolSummaries(historyBefore);
    return {
      response,
      messages: this.messages,
      toolSummaries,
      contextState: this.getContextState(),
    };
  }

  private buildInterruptedResult(historyBefore: number): IExecutionResult {
    const history = this.getSessionOrThrow().getHistory();
    const toolSummaries = this.extractToolSummaries(historyBefore);
    const parts: string[] = [];
    for (let i = historyBefore; i < history.length; i++) {
      const msg = history[i];
      if (msg?.role === 'assistant' && msg.content) parts.push(msg.content);
    }
    return {
      response: parts.join('\n\n'),
      messages: this.messages,
      toolSummaries,
      contextState: this.getContextState(),
    };
  }

  private extractToolSummaries(historyBefore: number): IToolSummary[] {
    const history = this.getSessionOrThrow().getHistory();
    const summaries: IToolSummary[] = [];
    for (let i = historyBefore; i < history.length; i++) {
      const msg = history[i];
      if (msg?.role === 'assistant' && msg.toolCalls) {
        for (const tc of msg.toolCalls as Array<{
          function: { name: string; arguments: string };
        }>) {
          summaries.push({ name: tc.function.name, args: tc.function.arguments });
        }
      }
    }
    return summaries;
  }

  private trimCompletedTools(): void {
    const completed = this.activeTools.filter((t) => !t.isRunning);
    if (completed.length > MAX_COMPLETED_TOOLS) {
      const excess = completed.length - MAX_COMPLETED_TOOLS;
      let removed = 0;
      this.activeTools = this.activeTools.filter((t) => {
        if (!t.isRunning && removed < excess) {
          removed++;
          return false;
        }
        return true;
      });
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && (err.message.includes('aborted') || err.message.includes('abort')))
  );
}

function extractFirstArg(toolArgs?: Record<string, unknown>): string {
  if (!toolArgs) return '';
  const firstVal = Object.values(toolArgs)[0];
  const raw = typeof firstVal === 'string' ? firstVal : JSON.stringify(firstVal ?? '');
  return raw.length > TOOL_ARG_DISPLAY_MAX
    ? raw.slice(0, TOOL_ARG_DISPLAY_MAX - TAIL_KEEP - 3) + '...' + raw.slice(-TAIL_KEEP)
    : raw;
}

const NOOP_TERMINAL = {
  write: (): void => {},
  writeLine: (): void => {},
  writeMarkdown: (): void => {},
  writeError: (): void => {},
  prompt: (): Promise<string> => Promise.resolve(''),
  select: (): Promise<number> => Promise.resolve(0),
  spinner: () => ({ stop: () => {}, update: () => {} }),
};
