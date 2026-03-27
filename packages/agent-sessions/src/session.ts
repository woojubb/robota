/**
 * Session — wraps a Robota agent instance with project context, permission state,
 * and optional session persistence.
 *
 * Design notes:
 * - Generic: accepts pre-constructed tools and provider (no hardcoded dependencies).
 * - Assembly (wiring tools, provider, system prompt) is done by the caller (agent-sdk).
 * - Internal concerns delegated to PermissionEnforcer, ContextWindowTracker, CompactionOrchestrator.
 */

import { Robota, TRUST_TO_MODE } from '@robota-sdk/agent-core';
import type {
  IAgentConfig,
  IAIProvider,
  TPermissionMode,
  IHookTypeExecutor,
} from '@robota-sdk/agent-core';
import type { SessionStore } from './session-store.js';
import type { ISessionLogger, TSessionLogData } from './session-logger.js';
import { PermissionEnforcer } from './permission-enforcer.js';
import type {
  TPermissionHandler,
  TPermissionResult,
  ITerminalOutput,
  ISpinner,
} from './permission-types.js';
import { ContextWindowTracker } from './context-window-tracker.js';
import { CompactionOrchestrator } from './compaction-orchestrator.js';
import type { ISessionOptions } from './session-types.js';
import { executeRun } from './session-run.js';
import { compact, persistSession } from './session-history-ops.js';
import { configureProvider, fireSessionStartHook } from './session-lifecycle.js';

export type { TPermissionHandler, TPermissionResult, ITerminalOutput, ISpinner, ISessionOptions };

const ID_RADIX = 36;
const ID_RANDOM_LENGTH = 9;

/**
 * Session class.
 *
 * Maintains conversation history by keeping the same Robota agent across multiple
 * run() calls.  The session ID is stable for the lifetime of the object.
 */
export class Session {
  private readonly robota: Robota;
  private readonly sessionId: string;
  private permissionMode: TPermissionMode;
  private readonly terminal: ITerminalOutput;
  private readonly sessionStore?: SessionStore;
  private readonly cwd: string;
  private readonly aiProvider: IAIProvider;
  private readonly systemMessage: string;
  private model: string;
  private readonly hooks?: Record<string, unknown>;
  private readonly hookTypeExecutors?: IHookTypeExecutor[];
  private readonly onCompactCallback?: (summary: string) => void;
  private readonly sessionLogger?: ISessionLogger;
  private readonly permissionEnforcer: PermissionEnforcer;
  private readonly contextTracker: ContextWindowTracker;
  private readonly compactionOrchestrator: CompactionOrchestrator;
  private messageCount = 0;
  private abortController: AbortController | null = null;
  /** Stdout collected from SessionStart hooks, injected on first run(). */
  private sessionStartStdout = '';

  constructor(options: ISessionOptions) {
    const { tools, provider, systemMessage, terminal, sessionStore, permissionHandler } = options;

    this.terminal = terminal;
    this.sessionStore = sessionStore;
    this.systemMessage = systemMessage;
    this.cwd = process.cwd();
    this.sessionLogger = options.sessionLogger;
    this.hooks = options.hooks;
    this.hookTypeExecutors = options.hookTypeExecutors;
    this.onCompactCallback = options.onCompact;
    this.model = options.model ?? 'claude-sonnet-4-5';
    this.sessionId =
      options.sessionId ??
      `session_${Date.now()}_${Math.random().toString(ID_RADIX).substr(2, ID_RANDOM_LENGTH)}`;

    this.permissionMode =
      options.permissionMode ??
      (options.defaultTrustLevel ? TRUST_TO_MODE[options.defaultTrustLevel] : undefined) ??
      'default';
    this.log('session_init', {
      cwd: this.cwd,
      systemPromptLength: systemMessage.length,
      model: this.model,
      provider: provider.name,
    });
    this.aiProvider = provider;
    configureProvider(provider, options, (event, data) => this.log(event, data));
    this.permissionEnforcer = new PermissionEnforcer({
      sessionId: this.sessionId,
      cwd: this.cwd,
      getPermissionMode: () => this.permissionMode,
      config: {
        permissions: options.permissions ?? { allow: [], deny: [] },
        hooks: options.hooks,
      },
      terminal,
      permissionHandler,
      promptForApprovalFn: options.promptForApproval,
      sessionLogger: options.sessionLogger,
      onToolExecution: options.onToolExecution,
      hookTypeExecutors: options.hookTypeExecutors,
    });

    this.contextTracker = new ContextWindowTracker(this.model, options.contextMaxTokens);
    this.compactionOrchestrator = new CompactionOrchestrator({
      sessionId: this.sessionId,
      cwd: this.cwd,
      model: this.model,
      hooks: options.hooks,
      compactInstructions: options.compactInstructions,
      hookTypeExecutors: options.hookTypeExecutors,
    });

    const wrappedTools = this.permissionEnforcer.wrapTools(tools);
    const agentConfig: IAgentConfig = {
      name: 'robota-cli',
      aiProviders: [provider],
      defaultModel: {
        provider: provider.name,
        model: this.model,
        systemMessage,
      },
      systemMessage,
      tools: wrappedTools,
      logging: { enabled: false },
    };

    this.robota = new Robota(agentConfig);
    fireSessionStartHook(this.sessionId, this.cwd, this.hooks, this.hookTypeExecutors, (stdout) => {
      this.sessionStartStdout = stdout;
    });
  }

  /**
   * Send a message to the agent and return the response.
   * @param message - The processed message to send to the AI
   * @param rawInput - Optional raw user input (used for hook prompt field)
   */
  async run(message: string, rawInput?: string): Promise<string> {
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      const response = await executeRun(
        message,
        rawInput,
        {
          sessionId: this.sessionId,
          cwd: this.cwd,
          model: this.model,
          robota: this.robota,
          aiProvider: this.aiProvider,
          contextTracker: this.contextTracker,
          hooks: this.hooks,
          hookTypeExecutors: this.hookTypeExecutors,
          sessionStartStdout: this.sessionStartStdout,
          log: (event, data) => this.log(event, data),
          compact: () => this.compact(),
          persistSession: () => this.persistSessionInternal(),
          getSessionStore: () => !!this.sessionStore,
          clearSessionStartStdout: () => {
            this.sessionStartStdout = '';
          },
        },
        signal,
      );
      this.messageCount += 1;
      return response;
    } finally {
      this.abortController = null;
    }
  }

  /** Delegate session event to the injected logger. */
  private log(event: string, data: TSessionLogData): void {
    this.sessionLogger?.log(this.sessionId, event, data);
  }

  /** Persist the current session to the store */
  private persistSessionInternal(): void {
    if (!this.sessionStore) return;
    persistSession({
      sessionId: this.sessionId,
      cwd: this.cwd,
      sessionStore: this.sessionStore,
      robota: this.robota,
      getFullHistory: () => this.getFullHistory(),
    });
  }

  /** Return the active permission mode */
  getPermissionMode(): TPermissionMode {
    return this.permissionMode;
  }

  /**
   * Change the active permission mode.
   * Future tool calls will be evaluated against the new mode.
   */
  setPermissionMode(mode: TPermissionMode): void {
    this.permissionMode = mode;
  }

  /** Return the stable session identifier */
  getSessionId(): string {
    return this.sessionId;
  }

  /** Return the number of run() calls completed */
  getMessageCount(): number {
    return this.messageCount;
  }

  /** Get tools that have been session-approved (via "Allow always" choice). */
  getSessionAllowedTools(): string[] {
    return this.permissionEnforcer.getSessionAllowedTools();
  }

  /** Clear all session-scoped allow rules. */
  clearSessionAllowedTools(): void {
    this.permissionEnforcer.clearSessionAllowedTools();
  }

  /** Abort the currently running execution. No-op if nothing is running. */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /** Whether a run() call is currently in progress. */
  isRunning(): boolean {
    return this.abortController !== null;
  }

  /** Get current context window state */
  getContextState() {
    return this.contextTracker.getContextState();
  }

  /**
   * Run compaction — summarize the conversation to free context space.
   * @param instructions - Optional focus instructions for the summary
   */
  async compact(instructions?: string): Promise<void> {
    await compact(instructions, {
      sessionId: this.sessionId,
      cwd: this.cwd,
      systemMessage: this.systemMessage,
      robota: this.robota,
      aiProvider: this.aiProvider,
      compactionOrchestrator: this.compactionOrchestrator,
      contextTracker: this.contextTracker,
      hooks: this.hooks,
      hookTypeExecutors: this.hookTypeExecutors,
      onCompactCallback: this.onCompactCallback,
      log: (event, data) => this.log(event, data),
    });
  }

  /**
   * Inject a message into the underlying Robota conversation history
   * without triggering execution. Used for session restore (replaying
   * prior messages so the AI provider has full context).
   */
  injectMessage(
    role: 'user' | 'assistant' | 'system' | 'tool',
    content: string,
    options?: { toolCallId?: string; name?: string },
  ): void {
    this.robota.injectMessage(role, content, options);
  }

  /** Clear conversation history */
  clearHistory(): void {
    this.robota.clearHistory();
    this.contextTracker.reset();
  }

  /** Get conversation history (chat messages only, backward compatible) */
  getHistory() {
    return this.robota.getHistory();
  }

  /** Get full history timeline including events */
  getFullHistory(): Array<{
    id: string;
    timestamp: Date;
    category: string;
    type: string;
    data?: unknown;
  }> {
    return this.robota.getFullHistory();
  }

  /** Add an event entry to history (not a chat message) */
  addHistoryEntry(entry: {
    id: string;
    timestamp: Date;
    category: string;
    type: string;
    data?: unknown;
  }): void {
    this.robota.addHistoryEntry(entry);
  }
}
