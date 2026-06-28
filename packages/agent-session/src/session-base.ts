import type { ContextWindowTracker, TAutoCompactThreshold } from './context-window-tracker.js';
import type { PermissionEnforcer } from './permission-enforcer.js';
import type {
  Robota,
  IAIProvider,
  IContextWindowState,
  IHistoryEntry,
  IToolSchema,
  TModelEffort,
  TPermissionMode,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

export abstract class SessionBase {
  protected abstract readonly robota: Robota;
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
  protected abstract abortController: AbortController | null;

  getPermissionMode(): TPermissionMode {
    return this.permissionMode;
  }

  /** Change the active permission mode — future tool calls will use the new mode. */
  setPermissionMode(mode: TPermissionMode): void {
    this.permissionMode = mode;
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
    this.robota.updateSystemPrompt(newMessage);
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
    effort?: TModelEffort;
    temperature?: number;
    maxOutputTokens?: number;
  }): Promise<void> {
    // `setModel` requires the agent to be fully initialized. On a fresh interactive session the
    // agent initializes lazily on the first `run()`, so a live model change before any message
    // (e.g. `/preset` right after launch) would otherwise hit the "must be fully initialized"
    // guard. Bring the agent to a ready state first — idempotent and side-effect-free.
    await this.robota.ensureReady();
    const nextModel = options.model ?? this.model;
    // The system prompt is not model config; it is updated independently via updateSystemMessage.
    this.robota.setModel({
      provider: this.aiProvider.name,
      model: nextModel,
      ...(options.effort !== undefined && { effort: options.effort }),
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.maxOutputTokens !== undefined && { maxTokens: options.maxOutputTokens }),
    });
    this.model = nextModel;
  }

  getToolSchemas(): IToolSchema[] {
    return this.toolSchemas;
  }

  getMessageCount(): number {
    return this.messageCount;
  }

  /** Get tools that have been session-approved (via "Allow always" choice). */
  getSessionAllowedTools(): string[] {
    return this.permissionEnforcer.getSessionAllowedTools();
  }

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

  isRunning(): boolean {
    return this.abortController !== null;
  }

  getContextState(): IContextWindowState {
    return this.contextTracker.getContextState();
  }

  /** Estimate context usage from current conversation history (used after session restore). */
  syncContextFromHistory(): void {
    this.contextTracker.updateFromHistory(this.robota.getHistory());
  }

  getAutoCompactThreshold(): TAutoCompactThreshold {
    return this.contextTracker.getAutoCompactThreshold();
  }

  setAutoCompactThreshold(threshold: number | false): void {
    this.contextTracker.setAutoCompactThreshold(threshold);
  }

  getHistory(): TUniversalMessage[] {
    return this.robota.getHistory();
  }

  getFullHistory(): IHistoryEntry[] {
    return this.robota.getFullHistory();
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

  /** Add an event entry to history (not a chat message) */
  addHistoryEntry(entry: IHistoryEntry): void {
    this.robota.addHistoryEntry(entry);
  }

  /** Inject a message into conversation history without execution (used for session restore). */
  injectMessage(
    role: 'user' | 'assistant' | 'system' | 'tool',
    content: string,
    options?: { toolCallId?: string; name?: string },
  ): void {
    this.robota.injectMessage(role, content, options);
  }

  /**
   * Inject a full TUniversalMessage preserving all fields (toolCalls, toolCallId, null content).
   * Used during session restore to correctly reconstruct tool_use+tool_result pairs.
   */
  injectRawMessage(msg: TUniversalMessage): void {
    this.robota.injectRawMessage(msg);
  }

  clearHistory(): void {
    this.robota.clearHistory();
    this.contextTracker.reset();
  }
}
