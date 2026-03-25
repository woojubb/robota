/**
 * InteractiveSession — event-driven session wrapper for any client.
 *
 * Wraps Session (composition) to provide streaming text accumulation,
 * tool execution state tracking, prompt queuing, abort orchestration,
 * and message history management. Previously embedded in CLI React hooks.
 *
 * Clients (CLI, web, API server, Dynamic Worker) subscribe to events
 * and call submit/abort/cancelQueue.
 */

import { createSession } from '../assembly/index.js';
import type { ICreateSessionOptions } from '../assembly/index.js';
import { FileSessionLogger } from '@robota-sdk/agent-sessions';
import type { Session } from '@robota-sdk/agent-sessions';
import { projectPaths } from '../paths.js';
import type { TUniversalMessage, IContextWindowState, TToolArgs } from '@robota-sdk/agent-core';
import {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
} from '@robota-sdk/agent-core';
import type {
  IToolState,
  IDiffLine,
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

export interface IInteractiveSessionOptions {
  config: ICreateSessionOptions['config'];
  context: ICreateSessionOptions['context'];
  projectInfo?: ICreateSessionOptions['projectInfo'];
  sessionStore?: ICreateSessionOptions['sessionStore'];
  permissionMode?: ICreateSessionOptions['permissionMode'];
  maxTurns?: number;
  cwd?: string;
  permissionHandler?: TInteractivePermissionHandler;
  /** Optional: inject pre-built session (for testing). */
  session?: Session;
}

export class InteractiveSession {
  private readonly session: Session;
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

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
    if (options.session) {
      this.session = options.session;
    } else {
      const cwd = options.cwd ?? process.cwd();
      const paths = projectPaths(cwd);

      this.session = createSession({
        config: options.config,
        context: options.context,
        projectInfo: options.projectInfo,
        sessionStore: options.sessionStore,
        permissionMode: options.permissionMode,
        maxTurns: options.maxTurns,
        terminal: NOOP_TERMINAL,
        sessionLogger: new FileSessionLogger(paths.logs),
        permissionHandler: options.permissionHandler,
        onTextDelta: (delta: string) => this.handleTextDelta(delta),
        onToolExecution: (event) => this.handleToolExecution(event),
      });
    }
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

  /** Submit a prompt. Queues if already executing (max 1 queued).
   *  displayInput overrides what appears as the user message (e.g., "/audit" instead of full skill prompt).
   *  rawInput is passed to Session.run() for hook matching (e.g., "/rulebased-harness:audit"). */
  async submit(input: string, displayInput?: string, rawInput?: string): Promise<void> {
    if (this.executing) {
      this.pendingPrompt = input;
      this.pendingDisplayInput = displayInput;
      this.pendingRawInput = rawInput;
      return;
    }
    await this.executePrompt(input, displayInput, rawInput);
  }

  /** Abort current execution and clear queue. */
  abort(): void {
    this.pendingPrompt = null;
    this.session.abort();
  }

  /** Cancel queued prompt without aborting current execution. */
  cancelQueue(): void {
    this.pendingPrompt = null;
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
    return this.session.getContextState();
  }

  getSession(): Session {
    return this.session;
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
    // displayInput: show user-facing text (e.g., "/audit") instead of full built prompt
    this.messages.push(createUserMessage(displayInput ?? input));

    const historyBefore = this.session.getHistory().length;

    try {
      // rawInput is passed to Session.run() for hook matching (UserPromptSubmit etc.)
      const response = await this.session.run(input, rawInput);
      this.flushStreaming();
      this.clearStreaming();

      const result = this.buildResult(response || '(empty response)', historyBefore);
      this.messages.push(createAssistantMessage(result.response));
      this.emit('complete', result);
      this.emit('context_update', this.getContextState());
    } catch (err) {
      this.flushStreaming();
      this.clearStreaming();

      if (isAbortError(err)) {
        const result = this.buildInterruptedResult(historyBefore);
        if (result.response) {
          this.messages.push(createAssistantMessage(result.response));
        }
        this.messages.push(createSystemMessage('Interrupted by user.'));
        this.emit('interrupted', result);
      } else {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.messages.push(createSystemMessage(`Error: ${errMsg}`));
        this.emit('error', err instanceof Error ? err : new Error(errMsg));
      }
    } finally {
      this.executing = false;
      this.emit('thinking', false);

      // Auto-execute queued prompt
      if (this.pendingPrompt) {
        const queued = this.pendingPrompt;
        const queuedDisplay = this.pendingDisplayInput;
        const queuedRaw = this.pendingRawInput;
        this.pendingPrompt = null;
        this.pendingDisplayInput = undefined;
        this.pendingRawInput = undefined;
        // Next tick to avoid re-entrancy
        setTimeout(() => this.executePrompt(queued, queuedDisplay, queuedRaw), 0);
      }
    }
  }

  // ── Streaming callbacks ───────────────────────────────────────

  private handleTextDelta(delta: string): void {
    this.streamingText += delta;
    this.emit('text_delta', delta);

    // Debounced flush for clients that poll getStreamingText()
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
      const state: IToolState = {
        toolName: event.toolName,
        firstArg,
        isRunning: true,
      };
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
        const finished: IToolState = {
          ...this.activeTools[idx]!,
          isRunning: false,
          result,
        };
        this.activeTools[idx] = finished;
        this.trimCompletedTools();
        this.emit('tool_end', finished);
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

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
    // Tool summaries are in IExecutionResult.toolSummaries — clients render them as they wish.
    // Do NOT push raw JSON into messages.
    return {
      response,
      messages: this.messages,
      toolSummaries,
      contextState: this.getContextState(),
    };
  }

  private buildInterruptedResult(historyBefore: number): IExecutionResult {
    const history = this.session.getHistory();
    const toolSummaries = this.extractToolSummaries(historyBefore);

    // Merge consecutive assistant messages from this execution
    const parts: string[] = [];
    for (let i = historyBefore; i < history.length; i++) {
      const msg = history[i];
      if (msg?.role === 'assistant' && msg.content) {
        parts.push(msg.content);
      }
    }

    return {
      response: parts.join('\n\n'),
      messages: this.messages,
      toolSummaries,
      contextState: this.getContextState(),
    };
  }

  private extractToolSummaries(historyBefore: number): IToolSummary[] {
    const history = this.session.getHistory();
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

/** No-op terminal for non-CLI clients. */
const NOOP_TERMINAL = {
  write: (): void => {},
  writeLine: (): void => {},
  writeMarkdown: (): void => {},
  writeError: (): void => {},
  prompt: (): Promise<string> => Promise.resolve(''),
  select: (): Promise<number> => Promise.resolve(0),
  spinner: () => ({ stop: () => {}, update: () => {} }),
};
