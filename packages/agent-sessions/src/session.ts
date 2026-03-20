/**
 * Session — wraps a Robota agent instance with project context, permission state,
 * and optional session persistence.
 *
 * Design notes:
 * - Generic: accepts pre-constructed tools and provider (no hardcoded dependencies).
 * - Assembly (wiring tools, provider, system prompt) is done by the caller (agent-sdk).
 * - Internal concerns delegated to PermissionEnforcer, ContextWindowTracker, CompactionOrchestrator.
 */

import { Robota, runHooks } from '@robota-sdk/agent-core';
import type { IAgentConfig, IAIProvider, IToolWithEventService } from '@robota-sdk/agent-core';
import type { TPermissionMode, TToolArgs, THooksConfig, IHookInput } from '@robota-sdk/agent-core';
import { TRUST_TO_MODE } from '@robota-sdk/agent-core';
import type { SessionStore, ISessionRecord } from './session-store.js';
import type { ISessionLogger, TSessionLogData } from './session-logger.js';
import { PermissionEnforcer } from './permission-enforcer.js';
import type {
  TPermissionHandler,
  TPermissionResult,
  ITerminalOutput,
  ISpinner,
} from './permission-enforcer.js';
import { ContextWindowTracker } from './context-window-tracker.js';
import { CompactionOrchestrator } from './compaction-orchestrator.js';

export type { TPermissionHandler, TPermissionResult, ITerminalOutput, ISpinner };

const ID_RADIX = 36;
const ID_RANDOM_LENGTH = 9;

/** Options for constructing a Session */
export interface ISessionOptions {
  /** Pre-constructed tools to register with the agent */
  tools: IToolWithEventService[];
  /** Pre-constructed AI provider */
  provider: IAIProvider;
  /** Pre-built system message string */
  systemMessage: string;
  /** Terminal I/O for permission prompts */
  terminal: ITerminalOutput;
  /** Permission and hook configuration */
  permissions?: { allow: string[]; deny: string[] };
  hooks?: Record<string, unknown>;
  /** Initial permission mode */
  permissionMode?: TPermissionMode;
  /** Default trust level — used to derive permissionMode if not given */
  defaultTrustLevel?: 'safe' | 'moderate' | 'full';
  /** Model name (for context window sizing and Robota config) */
  model?: string;
  /** Maximum number of agentic turns per run() call. Undefined = unlimited. */
  maxTurns?: number;
  /** Optional session store for persistence */
  sessionStore?: SessionStore;
  /** Custom permission handler (overrides terminal-based prompts, used by Ink UI) */
  permissionHandler?: TPermissionHandler;
  /** Callback for text deltas — enables streaming text to the UI in real-time */
  onTextDelta?: (delta: string) => void;
  /** Custom prompt-for-approval function (injected from CLI) */
  promptForApproval?: (
    terminal: ITerminalOutput,
    toolName: string,
    toolArgs: TToolArgs,
  ) => Promise<boolean>;
  /** Callback when context is compacted */
  onCompact?: (summary: string) => void;
  /** Instructions to include in the compaction prompt (e.g. from CLAUDE.md) */
  compactInstructions?: string;
  /** Override context max tokens (otherwise derived from model name) */
  contextMaxTokens?: number;
  /** Session logger — injected for pluggable session event logging. */
  sessionLogger?: ISessionLogger;
}

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
  private readonly model: string;
  private readonly hooks?: Record<string, unknown>;
  private readonly onCompactCallback?: (summary: string) => void;
  private readonly sessionLogger?: ISessionLogger;
  private readonly permissionEnforcer: PermissionEnforcer;
  private readonly contextTracker: ContextWindowTracker;
  private readonly compactionOrchestrator: CompactionOrchestrator;
  private messageCount = 0;
  private abortController: AbortController | null = null;

  constructor(options: ISessionOptions) {
    const { tools, provider, systemMessage, terminal, sessionStore, permissionHandler } = options;

    this.terminal = terminal;
    this.sessionStore = sessionStore;
    this.cwd = process.cwd();
    this.sessionLogger = options.sessionLogger;
    this.hooks = options.hooks;
    this.onCompactCallback = options.onCompact;
    this.model = options.model ?? 'claude-sonnet-4-5';
    this.sessionId = `session_${Date.now()}_${Math.random().toString(ID_RADIX).substr(2, ID_RANDOM_LENGTH)}`;

    // Resolve permission mode
    this.permissionMode =
      options.permissionMode ??
      (options.defaultTrustLevel ? TRUST_TO_MODE[options.defaultTrustLevel] : undefined) ??
      'default';

    // Log session initialization context
    this.log('session_init', {
      cwd: this.cwd,
      systemPromptLength: systemMessage.length,
      model: this.model,
      provider: provider.name,
    });

    // Store AI provider and configure streaming/web tools
    this.aiProvider = provider;
    this.configureProvider(provider, options);

    // Initialize sub-components
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
    });

    this.contextTracker = new ContextWindowTracker(this.model, options.contextMaxTokens);

    this.compactionOrchestrator = new CompactionOrchestrator({
      sessionId: this.sessionId,
      cwd: this.cwd,
      model: this.model,
      hooks: options.hooks,
      compactInstructions: options.compactInstructions,
    });

    // Wrap tools with permission enforcement
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
  }

  /** Configure provider-specific features (streaming, web tools, server tool logging) */
  private configureProvider(provider: IAIProvider, options: ISessionOptions): void {
    // Enable Anthropic server web tools (web_search)
    if (provider.name === 'anthropic' && 'enableWebTools' in provider) {
      (provider as { enableWebTools: boolean }).enableWebTools = true;
    }

    if (options.onTextDelta && 'onTextDelta' in provider) {
      (provider as { onTextDelta?: (delta: string) => void }).onTextDelta = options.onTextDelta;
    }

    // Wire server tool logging
    if ('onServerToolUse' in provider) {
      const sessionRef = this;
      (
        provider as { onServerToolUse?: (name: string, input: Record<string, string>) => void }
      ).onServerToolUse = (name: string, input: Record<string, string>) => {
        sessionRef.log('server_tool', { tool: name, ...input });
      };
    }
  }

  /**
   * Send a message to the agent and return the response.
   */
  async run(message: string): Promise<string> {
    this.log('user', { content: message });

    const history = this.robota.getHistory();
    const historyJson = JSON.stringify(history);
    const providerHasWebTools =
      'enableWebTools' in this.aiProvider &&
      (this.aiProvider as { enableWebTools?: boolean }).enableWebTools === true;
    this.log('pre_run', {
      historyLength: history.length,
      historyChars: historyJson.length,
      historyEstTokens: Math.ceil(historyJson.length / 4),
      model: this.model,
      provider: this.aiProvider.name,
      maxTokens: this.contextTracker.getContextState().maxTokens,
      webToolsEnabled: providerHasWebTools,
    });

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    let response: string;
    try {
      response = await new Promise<string>((resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        const onAbort = (): void => reject(new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
        this.robota.run(message).then(
          (result) => {
            signal.removeEventListener('abort', onAbort);
            resolve(result);
          },
          (err) => {
            signal.removeEventListener('abort', onAbort);
            reject(err);
          },
        );
      });
    } finally {
      this.abortController = null;
    }
    this.messageCount += 1;

    // Log the response and full history structure
    const postHistory = this.robota.getHistory();
    const historyStructure = postHistory.map((msg) => {
      const hasToolCalls =
        'toolCalls' in msg && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0;
      const toolCallNames = hasToolCalls
        ? (msg.toolCalls as Array<{ function: { name: string } }>).map((tc) => tc.function.name)
        : [];
      return {
        role: msg.role,
        contentLength: typeof msg.content === 'string' ? msg.content.length : 0,
        hasToolCalls,
        toolCallNames,
        ...(msg.metadata ? { metadata: msg.metadata } : {}),
      };
    });
    this.log('assistant', {
      content: response.substring(0, 500),
      historyLength: postHistory.length,
      estimatedChars: JSON.stringify(postHistory).length,
      historyStructure,
    });

    // Update token usage from the latest assistant message metadata
    this.contextTracker.updateFromHistory(postHistory);

    const ctxState = this.contextTracker.getContextState();
    this.log('context', {
      maxTokens: ctxState.maxTokens,
      usedTokens: ctxState.usedTokens,
      usedPercentage: ctxState.usedPercentage,
      remainingPercentage: ctxState.remainingPercentage,
    });

    // Auto-compact if threshold exceeded
    if (this.contextTracker.shouldAutoCompact()) {
      await this.compact();
    }

    if (this.sessionStore) {
      this.persistSession();
    }

    return response;
  }

  /** Delegate session event to the injected logger. */
  private log(event: string, data: TSessionLogData): void {
    this.sessionLogger?.log(this.sessionId, event, data);
  }

  /** Persist the current session to the store */
  private persistSession(): void {
    if (!this.sessionStore) return;

    const history = this.robota.getHistory();
    const now = new Date().toISOString();

    const existing = this.sessionStore.load(this.sessionId);

    const record: ISessionRecord = {
      id: this.sessionId,
      cwd: this.cwd,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      messages: history,
    };

    this.sessionStore.save(record);
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
    const history = this.robota.getHistory();
    if (history.length === 0) return;

    const trigger: 'auto' | 'manual' = instructions !== undefined ? 'manual' : 'auto';

    const summary = await this.compactionOrchestrator.compact(
      this.aiProvider,
      history,
      instructions,
    );

    // Replace history with summary message
    this.robota.clearHistory();
    await this.robota.run(
      `[Context Summary]\n${summary}\n\nPlease continue from where we left off.`,
    );

    // Reset token tracking based on the new shorter history
    this.contextTracker.updateFromHistory(this.robota.getHistory());

    // Fire PostCompact hook after history replacement is complete
    const postHookInput: IHookInput = {
      session_id: this.sessionId,
      cwd: this.cwd,
      hook_event_name: 'PostCompact',
      trigger,
      compact_summary: summary,
    };
    runHooks(this.hooks as THooksConfig | undefined, 'PostCompact', postHookInput).catch(() => {});

    // Notify via callback after compaction is fully complete
    if (this.onCompactCallback) {
      this.onCompactCallback(summary);
    }
  }

  /** Clear conversation history */
  clearHistory(): void {
    this.robota.clearHistory();
    this.contextTracker.reset();
  }

  /** Get conversation history */
  getHistory() {
    return this.robota.getHistory();
  }
}
