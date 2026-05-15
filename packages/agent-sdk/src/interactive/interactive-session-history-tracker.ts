/**
 * SessionHistoryTracker — manages history, edit checkpoints, memory events,
 * context references, and skill activation events for an InteractiveSession.
 */

import { randomUUID } from 'node:crypto';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import type { IMemoryEvent, IMemoryReference } from '../memory/automatic-memory-types.js';
import type {
  IContextReferenceAddResult,
  IContextReferenceClearResult,
  IContextReferenceItem,
  IContextReferenceRemoveResult,
} from '../context/context-reference-inventory.js';
import {
  clearContextReferences,
  removeContextReference,
} from '../context/context-reference-inventory.js';
import {
  addInteractiveContextReference,
  recordInteractiveContextReferences,
} from './interactive-session-context-references.js';
import type { IPromptFileReferenceRecord } from '../context/prompt-file-references.js';
import { EditCheckpointStore } from '../checkpoints/edit-checkpoint-store.js';
import type {
  IEditCheckpointInspection,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
} from '../checkpoints/edit-checkpoint-types.js';
import type { ISkillActivationEvent } from '../commands/skill-activation-events.js';
import { formatSkillActivationMessage } from '../commands/skill-activation-events.js';

export interface IHistoryTrackerState {
  history: IHistoryEntry[];
  memoryEvents: IMemoryEvent[];
  usedMemoryReferences: IMemoryReference[];
  contextReferences: IContextReferenceItem[];
  skillActivationEvents: ISkillActivationEvent[];
}

export class SessionHistoryTracker {
  private history: IHistoryEntry[] = [];
  private editCheckpointStore: EditCheckpointStore | null = null;
  private memoryEvents: IMemoryEvent[] = [];
  private usedMemoryReferences: IMemoryReference[] = [];
  private contextReferences: IContextReferenceItem[] = [];
  private skillActivationEvents: ISkillActivationEvent[] = [];

  constructor(
    private readonly cwd: string,
    private readonly getSessionId: () => string,
    private readonly getExecuting: () => boolean,
    private readonly persistSession: () => void,
    private readonly emitSkillActivation: (event: ISkillActivationEvent) => void,
    editCheckpointStore: EditCheckpointStore | null = null,
  ) {
    this.editCheckpointStore = editCheckpointStore;
  }

  restoreState(state: IHistoryTrackerState): void {
    this.history = state.history;
    this.memoryEvents = state.memoryEvents;
    this.usedMemoryReferences = state.usedMemoryReferences;
    this.contextReferences = state.contextReferences;
    this.skillActivationEvents = state.skillActivationEvents;
  }

  getState(): IHistoryTrackerState {
    return {
      history: this.history,
      memoryEvents: this.memoryEvents,
      usedMemoryReferences: this.usedMemoryReferences,
      contextReferences: this.contextReferences,
      skillActivationEvents: this.skillActivationEvents,
    };
  }

  append(entry: IHistoryEntry): void {
    this.history.push(entry);
  }

  getHistory(): IHistoryEntry[] {
    return this.history;
  }

  clearHistory(): void {
    this.history = [];
    this.memoryEvents = [];
    this.usedMemoryReferences = [];
  }

  resetUsedMemoryReferences(): void {
    this.usedMemoryReferences = [];
  }

  recordContextReferenceUsage(records: readonly IPromptFileReferenceRecord[]): void {
    this.contextReferences = recordInteractiveContextReferences(this.contextReferences, records, {
      loadType: 'manual',
      status: 'active',
    });
    this.persistSession();
  }

  recordPromptContextReferences(records: readonly IPromptFileReferenceRecord[]): void {
    this.contextReferences = recordInteractiveContextReferences(this.contextReferences, records, {
      loadType: 'prompt-reference',
      status: 'observed',
    });
    this.persistSession();
  }

  listEditCheckpoints(): IEditCheckpointSummary[] {
    const sessionId = this.getSessionId();
    return this.getCheckpointStore().list(sessionId);
  }

  inspectEditCheckpoint(checkpointId: string): IEditCheckpointInspection {
    const sessionId = this.getSessionId();
    return this.getCheckpointStore().inspect(sessionId, checkpointId);
  }

  async restoreEditCheckpoint(checkpointId: string): Promise<IEditCheckpointRestoreResult> {
    if (this.getExecuting()) {
      throw new Error('Cannot restore edit checkpoint while a prompt is running.');
    }
    const result = await this.getCheckpointStore().restoreToCheckpoint(
      this.getSessionId(),
      checkpointId,
    );
    this.history.push(
      messageToHistoryEntry(createSystemMessage(`Restored edit checkpoint: ${checkpointId}`)),
    );
    this.persistSession();
    return result;
  }

  async rollbackEditCheckpoint(checkpointId: string): Promise<IEditCheckpointRestoreResult> {
    if (this.getExecuting()) {
      throw new Error('Cannot rollback edit checkpoint while a prompt is running.');
    }
    const result = await this.getCheckpointStore().rollbackThroughCheckpoint(
      this.getSessionId(),
      checkpointId,
    );
    this.history.push(
      messageToHistoryEntry(createSystemMessage(`Rolled back edit checkpoint: ${checkpointId}`)),
    );
    this.persistSession();
    return result;
  }

  async beginEditCheckpointTurn(prompt: string): Promise<void> {
    if (!this.editCheckpointStore) return;
    await this.editCheckpointStore.beginTurn({ sessionId: this.getSessionId(), prompt });
  }

  async finalizeEditCheckpointTurn(): Promise<void> {
    if (!this.editCheckpointStore) return;
    try {
      await this.editCheckpointStore.finalizeTurn();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.history.push(
        messageToHistoryEntry(createSystemMessage(`Checkpoint error: ${err.message}`)),
      );
      throw err;
    }
  }

  setEditCheckpointStore(store: EditCheckpointStore): void {
    this.editCheckpointStore = store;
  }

  getUsedMemoryReferences(): IMemoryReference[] {
    return [...this.usedMemoryReferences];
  }

  recordMemoryEvent(event: IMemoryEvent): void {
    this.memoryEvents.push(event);
    this.persistSession();
  }

  listContextReferences(): IContextReferenceItem[] {
    return [...this.contextReferences];
  }

  async addContextReference(path: string): Promise<IContextReferenceAddResult> {
    const { references, result } = await addInteractiveContextReference(
      this.contextReferences,
      path,
      this.cwd || process.cwd(),
    );
    this.contextReferences = references;
    this.persistSession();
    return result;
  }

  removeContextReference(path: string): IContextReferenceRemoveResult {
    const result = removeContextReference(this.contextReferences, path);
    this.contextReferences = result.references;
    this.persistSession();
    return result.result;
  }

  clearContextReferences(): IContextReferenceClearResult {
    const result = clearContextReferences(this.contextReferences);
    this.contextReferences = [];
    this.persistSession();
    return result;
  }

  getSkillActivationEvents(): ISkillActivationEvent[] {
    return [...this.skillActivationEvents];
  }

  recordSkillActivationEvent(event: ISkillActivationEvent, appendHistory: boolean): void {
    this.skillActivationEvents.push(event);
    if (appendHistory) {
      this.history.push({
        id: randomUUID(),
        timestamp: new Date(event.timestamp),
        category: 'event',
        type: 'skill-activation',
        data: {
          ...event,
          message: formatSkillActivationMessage(event),
        },
      });
    }
    this.emitSkillActivation(event);
    this.persistSession();
  }

  private getCheckpointStore(): EditCheckpointStore {
    if (!this.editCheckpointStore) {
      this.editCheckpointStore = new EditCheckpointStore({ cwd: this.cwd || process.cwd() });
    }
    return this.editCheckpointStore;
  }
}
