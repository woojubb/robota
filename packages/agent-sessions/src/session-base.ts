import type {
  Robota,
  IAIProvider,
  IToolSchema,
  TPermissionMode,
  IHistoryEntry,
} from '@robota-sdk/agent-core';
import type { PermissionEnforcer } from './permission-enforcer.js';
import type { ContextWindowTracker } from './context-window-tracker.js';

export abstract class SessionBase {
  protected abstract readonly robota: Robota;
  protected abstract readonly permissionEnforcer: PermissionEnforcer;
  protected abstract readonly contextTracker: ContextWindowTracker;
  protected abstract permissionMode: TPermissionMode;
  protected abstract readonly sessionId: string;
  protected abstract readonly aiProvider: IAIProvider;
  protected abstract readonly toolSchemas: IToolSchema[];
  protected abstract readonly model: string;
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

  getSessionId(): string {
    return this.sessionId;
  }

  getSystemMessage(): string {
    return this.systemMessage;
  }

  /** Replace the active system message and propagate to the agent (used by staleness detection). */
  updateSystemMessage(newMessage: string): void {
    this.systemMessage = newMessage;
    this.robota.setModel({
      provider: this.aiProvider.name,
      model: this.model,
      systemMessage: newMessage,
    });
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

  getContextState() {
    return this.contextTracker.getContextState();
  }

  getAutoCompactThreshold() {
    return this.contextTracker.getAutoCompactThreshold();
  }

  setAutoCompactThreshold(threshold: number | false): void {
    this.contextTracker.setAutoCompactThreshold(threshold);
  }

  getHistory() {
    return this.robota.getHistory();
  }

  getFullHistory(): IHistoryEntry[] {
    return this.robota.getFullHistory();
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

  clearHistory(): void {
    this.robota.clearHistory();
    this.contextTracker.reset();
  }
}
