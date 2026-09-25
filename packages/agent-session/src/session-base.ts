import { requireExecutionRoot } from './execution-root.js';
import { TurnClaim } from './turn-claim.js';

import type { ContextWindowTracker, TAutoCompactThreshold } from './context-window-tracker.js';
import type { PermissionEnforcer } from './permission-enforcer.js';
import type { IPermissionDenial } from './permission-denial-log.js';
import type {
  Robota,
  IAIProvider,
  IContextWindowState,
  IHistoryEntry,
  IToolSchema,
  TModelEffort,
  TModelEffortSelection,
  TPermissionMode,
  TToolArgs,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

export abstract class SessionBase {
  protected abstract readonly agent: Robota;
  protected abstract readonly permissionEnforcer: PermissionEnforcer;
  protected abstract readonly contextTracker: ContextWindowTracker;
  protected abstract permissionMode: TPermissionMode;
  protected abstract activePresetId: string;
  protected abstract parallelSubagentsEnabled: boolean;
  protected abstract readonly sessionId: string;
  protected abstract readonly aiProvider: IAIProvider;
  protected abstract readonly toolSchemas: IToolSchema[];
  protected abstract model: string;
  protected abstract systemMessage: string;
  protected abstract messageCount: number;
  /** ARCH-010: the session's execution root — owned here, with the check that it was supplied. */
  protected readonly cwd: string;

  protected constructor(cwd: string) {
    this.cwd = requireExecutionRoot(cwd);
  }
  /**
   * RUNTIME-003: the turn currently running, and its owner. Was a bare `AbortController | null` that
   * `run()` overwrote, which is why `abort()` and `isRunning()` below could answer about a turn that
   * was not the one in flight. See `turn-claim.ts`.
   */
  protected readonly turnClaim = new TurnClaim();
  private readonly permissionModeGuards = new Set<(next: TPermissionMode) => void>();

  getPermissionMode(): TPermissionMode {
    return this.permissionMode;
  }

  /** Change the active permission mode — future tool calls will use the new mode. */
  setPermissionMode(mode: TPermissionMode): void {
    for (const guard of this.permissionModeGuards) guard(mode);
    this.permissionMode = mode;
  }

  /** Register a synchronous policy check at the single session-mode mutation boundary. */
  addPermissionModeGuard(guard: (next: TPermissionMode) => void): () => void {
    this.permissionModeGuards.add(guard);
    return () => this.permissionModeGuards.delete(guard);
  }

  /** Read the active preset id (PRESET-011 runtime state). */
  getActivePresetId(): string {
    return this.activePresetId;
  }

  /**
   * Set the active preset id. PURE STATE — this only records which preset is active;
   * it does not re-apply any preset options (permission/model/persona). Higher layers
   * own re-application (PRESET-012/013/014).
   */
  setActivePresetId(id: string): void {
    this.activePresetId = id;
  }

  /** Whether subagent dispatch is currently allowed for this session (PRESET-016 runtime gate). */
  getParallelSubagentsEnabled(): boolean {
    return this.parallelSubagentsEnabled;
  }

  /** Toggle subagent dispatch live. Only effective if the agent runtime was built at assembly. */
  setParallelSubagentsEnabled(enabled: boolean): void {
    this.parallelSubagentsEnabled = enabled;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * The session's execution root (ARCH-010).
   *
   * Readable because a caller that derives something FROM the session — a fork, a subagent, a hook
   * input — must be able to ask which root this session actually runs in. Re-deriving it from
   * `process.cwd()` is how the two silently diverged.
   */
  getCwd(): string {
    return this.cwd;
  }

  getSystemMessage(): string {
    return this.systemMessage;
  }

  /**
   * Replace the active system message and propagate it so the next provider request carries it.
   * Records the live value on `this.systemMessage` (re-injected on compaction) and delegates to
   * `Robota.updateSystemPrompt`, which updates the single-source `config.systemMessage` and the live
   * conversation store head. The system prompt is an agent-level concern, not model config, so this
   * does not route through `setModel`. Used by persona application, the self-verification toggle, and
   * AGENTS.md/CLAUDE.md staleness refresh.
   */
  updateSystemMessage(newMessage: string): void {
    this.systemMessage = newMessage;
    this.agent.updateSystemPrompt(newMessage);
  }

  /**
   * Re-apply model options to the live session (PRESET-013 model/effort re-application seam).
   *
   * Propagates model/effort/temperature/maxOutputTokens to the agent via `robota.setModel` so the
   * next call reflects them, and updates `this.model` to keep `getModelId()` accurate. The preset
   * `maxOutputTokens` field maps to the agent's `maxTokens` channel. Absent fields are left untouched.
   */
  async applyModelOptions(options: {
    model?: string;
    effort?: TModelEffortSelection;
    temperature?: number;
    maxOutputTokens?: number;
  }): Promise<void> {
    // `setModel` requires the agent to be fully initialized. On a fresh interactive session the
    // agent initializes lazily on the first `run()`, so a live model change before any message
    // (e.g. `/preset` right after launch) would otherwise hit the "must be fully initialized"
    // guard. Bring the agent to a ready state first — idempotent and side-effect-free.
    await this.agent.ensureReady();
    const nextModel = options.model ?? this.model;
    // The system prompt is not model config; it is updated independently via updateSystemMessage.
    this.agent.setModel({
      provider: this.aiProvider.name,
      model: nextModel,
      ...(options.effort !== undefined && { effort: options.effort }),
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.maxOutputTokens !== undefined && { maxTokens: options.maxOutputTokens }),
    });
    this.model = nextModel;
  }

  /** Read the selection for the next model call; provider default remains `auto`. */
  getModelEffort(): TModelEffortSelection {
    // Some lightweight session doubles intentionally implement only the execution surface. Keep
    // this read-only projection total for those callers; the real Robota instance exposes getModel.
    const getModel = (
      this.agent as Robota & { getModel?: () => { effort?: TModelEffortSelection } }
    ).getModel;
    if (getModel === undefined) return 'auto';
    try {
      return getModel.call(this.agent).effort ?? 'auto';
    } catch (error) {
      // Preserve the agent's own [LIFECYCLE] error when a destroyed agent is subsequently run.
      if (error instanceof Error && /disposed/i.test(error.message)) return 'auto';
      throw error;
    }
  }

  /** Run an operation with a temporary effort override and restore it on every exit path. */
  async withScopedModelEffort<T>(effort: TModelEffort, operation: () => Promise<T>): Promise<T> {
    const previous = this.getModelEffort();
    await this.applyModelOptions({ effort });
    try {
      return await operation();
    } finally {
      await this.applyModelOptions({ effort: previous });
    }
  }

  /**
   * Re-apply the agent's identity label to a LIVE session.
   *
   * ARCH-040 (issue #1820): a preset's `agentName` reached the agent only at construction, so
   * starting with a preset set the name while switching to the SAME preset mid-session left the old
   * one — one preset with two answers, decided by when it was chosen.
   *
   * Goes through `updateConfiguration`, the agent's own config seam: the agent's `name` reads THROUGH
   * its config, so writing the config is the whole rename and no copy is left stale.
   */
  async applyAgentName(name: string): Promise<void> {
    await this.agent.updateConfiguration({ name });
  }

  getToolSchemas(): IToolSchema[] {
    return this.toolSchemas;
  }

  getMessageCount(): number {
    return this.messageCount;
  }

  /** Get tools that have been session-approved (via "Allow always" choice). */
  /**
   * ARCH-040 Group C (issue #1934): re-apply a preset's tool lists to the live enforcer.
   *
   * The BASE it composes onto is the session's configured rules minus whatever a previous preset
   * contributed — which is why the enforcer keeps the original: an allowlist REPLACES the preset
   * layer's contribution rather than accumulating across successive `/preset` switches, while a
   * denial UNIONS because it must not be weakened by a later layer that forgot to repeat it.
   */
  applyPresetToolLists(preset: {
    allowedTools?: readonly string[];
    deniedTools?: readonly string[];
  }): void {
    this.permissionEnforcer.applyPresetToolLists(preset);
  }

  /**
   * The rules this session's gate reads right now — settings, preset lists and command auto-allows
   * together — so a subagent inherits what the parent actually enforces (issue #3081). Session-scoped
   * "allow always" consent is not included: it was given for this session's context.
   */
  getPermissionRules(): { allow: string[]; deny: string[]; ask: string[] } {
    const rules = this.permissionEnforcer.currentPermissionRules();
    return { allow: [...rules.allow], deny: [...rules.deny], ask: [...rules.ask] };
  }

  getSessionAllowedTools(): string[] {
    return this.permissionEnforcer.getSessionAllowedTools();
  }

  /**
   * Decide a call to `toolName` with `toolArgs` exactly as this session's gate would decide the
   * tool call itself — rules, mode, remembered consent and the prompt. For an action that reaches
   * a tool's effect by another route (a command that starts a process), so that route cannot be a
   * way around the tool's own permission.
   */
  checkToolPermission(
    toolName: string,
    toolArgs: TToolArgs,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return this.permissionEnforcer.checkPermission(toolName, toolArgs, signal);
  }

  /** `auto` mode hands decisions to a classifier, so a session without one cannot enter it. */
  protected requireClassifierFor(mode: TPermissionMode): void {
    if (mode === 'auto' && !this.permissionEnforcer.hasPermissionClassifier()) {
      throw new Error('Auto mode is unavailable: this session has no permission classifier.');
    }
  }

  /**
   * Let the call behind a classifier denial (by its index in the recent denials) run once when the
   * model tries it again. Returns the denial, or `undefined` when the index names no classifier
   * denial.
   */
  retryPermissionDenial(index: number): IPermissionDenial | undefined {
    return this.permissionEnforcer.allowRetryOfDenial(index);
  }

  /** The calls this session refused, most recent first (issue #3082). */
  getRecentPermissionDenials(): readonly IPermissionDenial[] {
    return this.permissionEnforcer.getRecentDenials();
  }

  clearSessionAllowedTools(): void {
    this.permissionEnforcer.clearSessionAllowedTools();
  }

  /** Abort the currently running execution. No-op if nothing is running. */
  abort(): void {
    this.turnClaim.abort();
  }

  isRunning(): boolean {
    return this.turnClaim.isRunning();
  }

  getContextState(): IContextWindowState {
    return this.contextTracker.getContextState();
  }

  /** Estimate context usage from current conversation history (used after session restore). */
  syncContextFromHistory(): void {
    this.contextTracker.updateFromHistory(this.agent.getHistory());
  }

  getAutoCompactThreshold(): TAutoCompactThreshold {
    return this.contextTracker.getAutoCompactThreshold();
  }

  setAutoCompactThreshold(threshold: number | false): void {
    this.contextTracker.setAutoCompactThreshold(threshold);
  }

  getHistory(): TUniversalMessage[] {
    return this.agent.getHistory();
  }

  getFullHistory(): IHistoryEntry[] {
    return this.agent.getFullHistory();
  }

  getSessionTokenUsage(): { inputTokens: number; outputTokens: number } | undefined {
    let inputTokens = 0;
    let outputTokens = 0;
    let found = false;
    for (const entry of this.getFullHistory()) {
      if (entry.category !== 'event' || entry.type !== 'usage-summary') continue;
      const snap = entry.data as { promptTokens?: number; completionTokens?: number } | undefined;
      inputTokens += snap?.promptTokens ?? 0;
      outputTokens += snap?.completionTokens ?? 0;
      found = true;
    }
    return found ? { inputTokens, outputTokens } : undefined;
  }

  getModelId(): string {
    return this.model;
  }

  /**
   * The tool schemas the model is offered at the next request (CLI-1990).
   *
   * The offered set, not the registered one: a deferred tool that has not been loaded is absent,
   * because it is absent from the request. `/context` reads this to report what the tool schemas
   * actually cost, which is the only surface that makes deferral's saving observable.
   */
  getOfferedToolSchemas(): IToolSchema[] {
    return this.agent.getOfferedToolSchemas();
  }

  /** The provider the session sends its turns to now; a provider switch replaces it. */
  getProvider(): IAIProvider {
    return this.aiProvider;
  }

  getProviderId(): string {
    return this.aiProvider.name;
  }

  /** Add an event entry to history (not a chat message) */
  addHistoryEntry(entry: IHistoryEntry): void {
    this.agent.addHistoryEntry(entry);
  }

  /** Inject a message into conversation history without execution (used for session restore). */
  injectMessage(
    role: 'user' | 'assistant' | 'system' | 'tool',
    content: string,
    options?: { toolCallId?: string; name?: string },
  ): void {
    this.agent.injectMessage(role, content, options);
  }

  /**
   * Inject a full TUniversalMessage preserving all fields (toolCalls, toolCallId, null content).
   * Used during session restore to correctly reconstruct tool_use+tool_result pairs.
   */
  injectRawMessage(msg: TUniversalMessage): void {
    this.agent.injectRawMessage(msg);
  }

  clearHistory(): void {
    this.agent.clearHistory();
    this.contextTracker.reset();
  }
}
