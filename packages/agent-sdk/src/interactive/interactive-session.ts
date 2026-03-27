/**
 * InteractiveSession — the single entry point for all SDK consumers.
 *
 * Wraps Session (composition). Manages streaming text accumulation,
 * tool execution state tracking, prompt queuing, abort orchestration,
 * message history, and system command execution.
 *
 * Config/context loading is internal. Consumer provides cwd + provider.
 */

import type { Session } from '@robota-sdk/agent-sessions';
import type { SessionStore } from '@robota-sdk/agent-sessions';
import type { TUniversalMessage, IContextWindowState, IHistoryEntry } from '@robota-sdk/agent-core';
import {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  messageToHistoryEntry,
} from '@robota-sdk/agent-core';
import { SystemCommandExecutor, createSystemCommands } from '../commands/system-command.js';
import type {
  IToolState,
  TInteractiveEventName,
  IInteractiveSessionEvents,
  ITransportAdapter,
} from './types.js';
import {
  isAbortError,
  buildResult,
  buildInterruptedResult,
  persistSession,
} from './interactive-session-execution.js';
import {
  STREAMING_FLUSH_INTERVAL_MS,
  pushToolSummaryToHistory,
  applyToolStart,
  applyToolEnd,
} from './interactive-session-streaming.js';
import {
  createInteractiveSession,
  injectSavedMessage,
  loadSessionRecord,
} from './interactive-session-init.js';
import type {
  IInteractiveSessionOptions,
  IInteractiveSessionStandardOptions,
} from './interactive-session-init.js';
export type { IInteractiveSessionOptions } from './interactive-session-init.js';

export class InteractiveSession {
  private session: Session | null = null;
  private readonly commandExecutor: SystemCommandExecutor;
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private streamingText = '';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private activeTools: IToolState[] = [];
  private executing = false;
  private pendingPrompt: string | null = null;
  private pendingDisplayInput: string | undefined;
  private pendingRawInput: string | undefined;
  private history: IHistoryEntry[] = [];
  private sessionStore?: SessionStore;
  private sessionName?: string;
  private cwd?: string;
  private pendingRestoreMessages: unknown[] | null = null;
  private resumeSessionId?: string;
  private forkSession: boolean;

  constructor(options: IInteractiveSessionOptions) {
    this.commandExecutor = new SystemCommandExecutor(createSystemCommands());
    this.sessionStore = options.sessionStore;
    this.sessionName = options.sessionName;
    this.cwd = ('cwd' in options ? options.cwd : undefined) ?? '';
    this.resumeSessionId = options.resumeSessionId;
    this.forkSession = options.forkSession ?? false;

    if ('session' in options && options.session) {
      this.session = options.session;
      this.initialized = true;
    } else {
      const stdOpts = options as IInteractiveSessionStandardOptions;
      this.initPromise = this.initializeAsync(stdOpts);
    }

    if (options.resumeSessionId && this.sessionStore) {
      const restored = loadSessionRecord(
        this.sessionStore,
        options.resumeSessionId,
        this.forkSession,
        this.session,
      );
      if (restored.history.length > 0) this.history = restored.history;
      if (restored.sessionName) this.sessionName = restored.sessionName;
      this.pendingRestoreMessages = restored.pendingRestoreMessages;
    }
  }

  private async initializeAsync(options: IInteractiveSessionStandardOptions): Promise<void> {
    this.session = await createInteractiveSession({
      cwd: options.cwd,
      provider: options.provider,
      permissionMode: options.permissionMode,
      maxTurns: options.maxTurns,
      permissionHandler: options.permissionHandler,
      resumeSessionId: this.resumeSessionId,
      forkSession: this.forkSession,
      onTextDelta: (delta: string) => this.handleTextDelta(delta),
      onToolExecution: (event) => this.handleToolExecution(event),
    });

    if (this.pendingRestoreMessages) {
      for (const msg of this.pendingRestoreMessages) injectSavedMessage(this.session, msg);
      this.pendingRestoreMessages = null;
    }
    this.initialized = true;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized && this.initPromise) await this.initPromise;
  }

  private getSessionOrThrow(): Session {
    if (!this.session)
      throw new Error('InteractiveSession not initialized. Call submit() or await initialization.');
    return this.session;
  }

  on<E extends TInteractiveEventName>(event: E, handler: IInteractiveSessionEvents[E]): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
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
    if (handlers) for (const handler of handlers) handler(...args);
  }

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

  async executeCommand(
    name: string,
    args: string,
  ): Promise<{ message: string; success: boolean; data?: Record<string, unknown> } | null> {
    await this.ensureInitialized();
    return this.commandExecutor.execute(name, this, args);
  }

  listCommands(): Array<{ name: string; description: string }> {
    return this.commandExecutor.listCommands().map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
    }));
  }

  abort(): void {
    this.clearPendingQueue();
    this.session?.abort();
  }
  cancelQueue(): void {
    this.clearPendingQueue();
  }

  private clearPendingQueue(): void {
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
  getFullHistory(): IHistoryEntry[] {
    return this.history;
  }
  getMessages(): TUniversalMessage[] {
    return this.history
      .filter((e) => e.category === 'chat')
      .map((e) => e.data as TUniversalMessage);
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
  getName(): string | undefined {
    return this.sessionName;
  }
  getSession(): Session {
    return this.getSessionOrThrow();
  }

  setName(name: string): void {
    this.sessionName = name;
    if (this.sessionStore && this.session) {
      try {
        const id = this.getSessionOrThrow().getSessionId();
        const existing = this.sessionStore.load(id);
        if (existing) {
          existing.name = name;
          existing.updatedAt = new Date().toISOString();
          this.sessionStore.save(existing);
        }
      } catch {
        /* Session not initialized yet */
      }
    }
  }

  attachTransport(transport: ITransportAdapter): void {
    transport.attach(this);
  }

  private async executePrompt(
    input: string,
    displayInput?: string,
    rawInput?: string,
  ): Promise<void> {
    this.executing = true;
    this.clearStreaming();
    this.emit('thinking', true);
    this.history.push(messageToHistoryEntry(createUserMessage(displayInput ?? input)));

    const historyBefore = this.getSessionOrThrow().getHistory().length;

    try {
      const response = await this.getSessionOrThrow().run(input, rawInput);
      this.flushStreaming();
      pushToolSummaryToHistory({ activeTools: this.activeTools, history: this.history });
      this.clearStreaming();
      const result = buildResult(
        response || '(empty response)',
        this.getSessionOrThrow().getHistory(),
        this.history,
        historyBefore,
        this.getContextState(),
      );
      this.history.push(messageToHistoryEntry(createAssistantMessage(result.response)));
      this.emit('complete', result);
      this.emit('context_update', this.getContextState());
    } catch (err) {
      this.flushStreaming();
      if (isAbortError(err)) {
        const result = buildInterruptedResult(
          this.getSessionOrThrow().getHistory(),
          this.history,
          historyBefore,
          this.getContextState(),
        );
        pushToolSummaryToHistory({ activeTools: this.activeTools, history: this.history });
        this.clearStreaming();
        if (result.response)
          this.history.push(messageToHistoryEntry(createAssistantMessage(result.response)));
        this.history.push(messageToHistoryEntry(createSystemMessage('Interrupted by user.')));
        this.emit('interrupted', result);
      } else {
        pushToolSummaryToHistory({ activeTools: this.activeTools, history: this.history });
        this.clearStreaming();
        const errMsg = err instanceof Error ? err.message : String(err);
        this.history.push(messageToHistoryEntry(createSystemMessage(`Error: ${errMsg}`)));
        this.emit('error', err instanceof Error ? err : new Error(errMsg));
      }
    } finally {
      this.executing = false;
      this.emit('thinking', false);
      if (this.sessionStore && this.session) {
        persistSession(
          this.sessionStore,
          this.session,
          this.sessionName,
          this.cwd ?? '',
          this.history,
        );
      }
      if (this.pendingPrompt) {
        const queued = this.pendingPrompt;
        const queuedDisplay = this.pendingDisplayInput;
        const queuedRaw = this.pendingRawInput;
        this.clearPendingQueue();
        setTimeout(() => this.executePrompt(queued, queuedDisplay, queuedRaw), 0);
      }
    }
  }

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
    const streamingState = { activeTools: this.activeTools, history: this.history };
    if (event.type === 'start') {
      const toolState = applyToolStart(streamingState, event);
      this.activeTools = streamingState.activeTools;
      this.emit('tool_start', toolState);
    } else {
      const finished = applyToolEnd(streamingState, event);
      this.activeTools = streamingState.activeTools;
      if (finished) this.emit('tool_end', finished);
    }
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
}
