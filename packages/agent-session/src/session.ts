import { TRUST_TO_MODE } from '@robota-sdk/agent-core';
import type {
  IAIProvider,
  IContextWindowState,
  IToolSchema,
  TPermissionMode,
  IHookTypeExecutor,
} from '@robota-sdk/agent-core';
import type { ISessionStore } from './session-store.js';
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
import type {
  ICompactEvent,
  ISessionOptions,
  ISessionShutdownOptions,
  TCompactTrigger,
} from './session-types.js';
import { executeRun } from './session-run.js';
import { compact, persistSession } from './session-history-ops.js';
import {
  configureProvider,
  fireSessionEndHook,
  fireSessionStartHook,
} from './session-lifecycle.js';
import { SessionBase } from './session-base.js';
import {
  buildPermissionEnforcer,
  buildRobota,
  buildSessionTrackers,
} from './session-components.js';
import type { Robota } from '@robota-sdk/agent-core';

export type {
  ICompactEvent,
  TPermissionHandler,
  TPermissionResult,
  ITerminalOutput,
  ISpinner,
  ISessionOptions,
  ISessionShutdownOptions,
  TCompactTrigger,
};
export type { TAutoCompactThreshold } from './context-window-tracker.js';

const ID_RADIX = 36;
const ID_RANDOM_LENGTH = 9;

/** Wraps a Robota agent with project context, permission state, and optional persistence. */
export class Session extends SessionBase {
  protected readonly robota: Robota;
  protected readonly permissionEnforcer: PermissionEnforcer;
  protected readonly contextTracker: ContextWindowTracker;
  protected permissionMode: TPermissionMode;
  protected readonly sessionId: string;
  protected readonly aiProvider: IAIProvider;
  protected readonly toolSchemas: IToolSchema[];
  protected readonly model: string;
  protected systemMessage: string;
  protected messageCount = 0;
  protected abortController: AbortController | null = null;
  private readonly terminal: ITerminalOutput;
  private readonly sessionStore?: ISessionStore;
  private readonly cwd: string;
  private readonly hooks?: Record<string, unknown>;
  private readonly hookTypeExecutors?: IHookTypeExecutor[];
  private readonly onTextDeltaCallback?: (delta: string) => void;
  private readonly onContextUpdateCallback?: (state: IContextWindowState) => void;
  private readonly onToolExecutionCallback?: ISessionOptions['onToolExecution'];
  private readonly onCompactCallback?: (summary: string) => void;
  private readonly onCompactEventCallback?: ISessionOptions['onCompactEvent'];
  private readonly sessionLogger?: ISessionLogger;
  private readonly maxTurns?: number;
  private readonly compactionOrchestrator: CompactionOrchestrator;
  private shutdownPromise: Promise<void> | null = null;
  /** Stdout collected from SessionStart hooks, injected on first run(). */
  private sessionStartStdout = '';
  /** Absolute path to the session transcript file, if file-backed storage is active. */
  private readonly transcriptPath: string | undefined;

  constructor(options: ISessionOptions) {
    super();
    const { tools, provider, systemMessage } = options;

    this.terminal = options.terminal;
    this.sessionStore = options.sessionStore;
    this.systemMessage = systemMessage;
    this.toolSchemas = tools.map((tool) => tool.schema);
    this.cwd = process.cwd();
    this.sessionLogger = options.sessionLogger;
    this.hooks = options.hooks;
    this.hookTypeExecutors = options.hookTypeExecutors;
    this.onTextDeltaCallback = options.onTextDelta;
    this.onContextUpdateCallback = options.onContextUpdate;
    this.onToolExecutionCallback = options.onToolExecution;
    this.onCompactCallback = options.onCompact;
    this.onCompactEventCallback = options.onCompactEvent;
    this.maxTurns = options.maxTurns;
    this.model = options.model ?? 'claude-sonnet-4-5';
    this.sessionId =
      options.sessionId ??
      `session_${Date.now()}_${Math.random().toString(ID_RADIX).substr(2, ID_RANDOM_LENGTH)}`;
    this.permissionMode =
      options.permissionMode ??
      (options.defaultTrustLevel ? TRUST_TO_MODE[options.defaultTrustLevel] : undefined) ??
      'default';
    this.transcriptPath = options.sessionStore?.getFilePath?.(this.sessionId);
    this.log('session_init', {
      cwd: this.cwd,
      systemPromptLength: systemMessage.length,
      systemPrompt: systemMessage,
      toolSchemas: this.toolSchemas,
      model: this.model,
      provider: provider.name,
    });
    this.aiProvider = provider;
    configureProvider(provider, options, (event, data) => this.log(event, data));
    this.permissionEnforcer = buildPermissionEnforcer(
      options,
      this.sessionId,
      this.cwd,
      () => this.permissionMode,
      this.transcriptPath,
    );
    const { contextTracker, compactionOrchestrator } = buildSessionTrackers(
      options,
      this.model,
      this.sessionId,
      this.cwd,
    );
    this.contextTracker = contextTracker;
    this.compactionOrchestrator = compactionOrchestrator;
    this.robota = buildRobota(
      options,
      this.permissionEnforcer,
      tools,
      provider,
      this.model,
      systemMessage,
    );
    fireSessionStartHook(
      this.sessionId,
      this.cwd,
      this.hooks,
      this.hookTypeExecutors,
      (stdout) => void (this.sessionStartStdout = stdout),
      this.permissionMode,
      this.transcriptPath,
    );
  }

  async run(message: string, rawInput?: string): Promise<string> {
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    try {
      const response = await executeRun(message, rawInput, this.buildRunContext(), signal);
      this.messageCount += 1;
      return response;
    } finally {
      this.abortController = null;
    }
  }

  private log(event: string, data: TSessionLogData): void {
    this.sessionLogger?.log(this.sessionId, event, data);
  }

  private persistSessionInternal(): void {
    if (!this.sessionStore) return;
    persistSession({
      sessionId: this.sessionId,
      cwd: this.cwd,
      systemPrompt: this.systemMessage,
      toolSchemas: this.toolSchemas,
      sessionStore: this.sessionStore,
      robota: this.robota,
      getFullHistory: () => this.getFullHistory(),
    });
  }

  /** Gracefully end the session and fire SessionEnd hooks once. */
  shutdown(options: ISessionShutdownOptions = {}): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    const reason = options.reason ?? 'other';
    this.shutdownPromise = (async () => {
      this.abort();
      this.log('session_shutdown', { reason });
      this.persistSessionInternal();
      await fireSessionEndHook(
        this.sessionId,
        this.cwd,
        reason,
        this.hooks,
        this.hookTypeExecutors,
        this.permissionMode,
        this.transcriptPath,
      );
    })();
    return this.shutdownPromise;
  }

  async compact(instructions?: string, trigger: TCompactTrigger = 'manual'): Promise<void> {
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
      onCompactEventCallback: this.onCompactEventCallback,
      trigger,
      log: (event, data) => this.log(event, data),
    });
  }

  private buildRunContext() {
    return {
      sessionId: this.sessionId,
      cwd: this.cwd,
      model: this.model,
      robota: this.robota,
      aiProvider: this.aiProvider,
      contextTracker: this.contextTracker,
      hooks: this.hooks,
      hookTypeExecutors: this.hookTypeExecutors,
      sessionStartStdout: this.sessionStartStdout,
      log: (event: string, data: TSessionLogData) => this.log(event, data),
      compact: () => this.compact(undefined, 'auto'),
      persistSession: () => this.persistSessionInternal(),
      getSessionStore: () => !!this.sessionStore,
      clearSessionStartStdout: () => void (this.sessionStartStdout = ''),
      permissionMode: this.permissionMode,
      transcriptPath: this.transcriptPath,
      maxTurns: this.maxTurns,
      onTextDelta: this.onTextDeltaCallback,
      onContextUpdate: this.onContextUpdateCallback,
      onToolExecution: this.onToolExecutionCallback,
      knownToolNames: this.toolSchemas.map((tool) => tool.name),
    };
  }
}
