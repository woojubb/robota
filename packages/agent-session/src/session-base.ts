import { requireExecutionRoot } from './execution-root.js';
import { TurnClaim } from './turn-claim.js';

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
    effort?: TModelEffort;
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
  getSessionAllowedTools(): string[] {
    return this.permissionEnforcer.getSessionAllowedTools();
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
