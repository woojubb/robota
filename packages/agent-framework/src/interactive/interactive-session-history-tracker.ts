/**
 * SessionHistoryTracker — manages history, edit checkpoints, memory events,
 * context references, and skill activation events for an InteractiveSession.
 */

import { randomUUID } from 'node:crypto';

import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';

import {
  addInteractiveContextReference,
  createSystemContextReferenceItems,
  recordInteractiveContextReferences,
} from './interactive-session-context-references.js';
import { EditCheckpointStore } from '../checkpoints/edit-checkpoint-store.js';
import { formatSkillActivationMessage } from '../commands/skill-activation-events.js';
import {
  clearContextReferences,
  removeContextReference,
} from '../context/context-reference-inventory.js';
import {
  VISIBLE_MEMORY_EVENT_TYPES,
  formatMemoryEventMessage,
} from '../memory/memory-event-format.js';

import type {
  IEditCheckpointInspection,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
} from '../checkpoints/edit-checkpoint-types.js';
import type { ISkillActivationEvent } from '../commands/skill-activation-events.js';
import type { IContextFileEntry } from '../context/context-file-tracker.js';
import type {
  IContextReferenceAddResult,
  IContextReferenceClearResult,
  IContextReferenceItem,
  IContextReferenceRemoveResult,
} from '../context/context-reference-inventory.js';
import type { IPromptFileReferenceRecord } from '../context/prompt-file-references.js';
import type { IMemoryEvent, IMemoryReference } from '../memory/automatic-memory-types.js';
import type { IHistoryEntry, TUniversalValue } from '@robota-sdk/agent-core';
import type { IActiveBranchPointer } from '@robota-sdk/agent-interface-transport';

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
  /**
   * SELFHOST-007: a persisted active-branch pointer restored (in the constructor) BEFORE the checkpoint
   * store exists on the standard/async construction path — stashed here and applied the moment the
   * store is set, so `--resume` reaches the store instead of silently dropping the pointer.
   */
  private pendingActiveBranch: IActiveBranchPointer | undefined = undefined;
  private memoryEvents: IMemoryEvent[] = [];
  private usedMemoryReferences: IMemoryReference[] = [];
  private contextReferences: IContextReferenceItem[] = [];
  private systemContextReferences: IContextReferenceItem[] = [];
  private skillActivationEvents: ISkillActivationEvent[] = [];

  constructor(
    private readonly cwd: string,
    private readonly getSessionId: () => string,
    private readonly getExecuting: () => boolean,
    private readonly persistSession: () => void,
    private readonly emitSkillActivation: (event: ISkillActivationEvent) => void,
    private readonly emitMemoryEvent: (event: IMemoryEvent) => void,
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

  // SELFHOST-007: branching time-travel — navigation delegates to the store's neutral tree.
  listCheckpointBranches(): string[] {
    return this.getCheckpointStore().listCheckpointBranches(this.getSessionId());
  }

  async forkCheckpointBranch(checkpointId: string): Promise<IEditCheckpointRestoreResult> {
    if (this.getExecuting()) {
      throw new Error('Cannot fork edit checkpoint while a prompt is running.');
    }
    // Fork = non-destructive restore: revert the working tree to the checkpoint while the abandoned
    // future stays on a sibling branch; the next turn diverges from here.
    const result = await this.getCheckpointStore().restoreToCheckpoint(
      this.getSessionId(),
      checkpointId,
    );
    this.history.push(
      messageToHistoryEntry(
        createSystemMessage(`Forked new branch from checkpoint: ${checkpointId}`),
      ),
    );
    this.persistSession();
    return result;
  }

  switchCheckpointBranch(checkpointId: string): void {
    if (this.getExecuting()) {
      throw new Error('Cannot switch edit checkpoint branch while a prompt is running.');
    }
    this.getCheckpointStore().switchToCheckpoint(this.getSessionId(), checkpointId);
    this.history.push(
      messageToHistoryEntry(createSystemMessage(`Switched to checkpoint branch: ${checkpointId}`)),
    );
    this.persistSession();
  }

  /** SELFHOST-007: the active-branch pointer to persist (so a branch survives --resume). */
  getActiveBranchPointer(): IActiveBranchPointer | undefined {
    if (!this.editCheckpointStore) return undefined;
    // Apply any stashed resume pointer first, so a persist that fires BEFORE the first checkpoint op
    // (resume → save → exit) does not clobber the on-disk pointer to undefined. No-op when unstashed.
    this.applyPendingActiveBranch();
    return this.editCheckpointStore.getActiveBranchPointer(this.getSessionId());
  }

  /**
   * SELFHOST-007: restore the active branch from a persisted pointer on resume (graceful on drift). If
   * the checkpoint store is not yet created (standard async construction path — the store is injected
   * later via {@link setEditCheckpointStore}), stash the pointer and apply it when the store arrives.
   */
  restoreActiveBranch(pointer: IActiveBranchPointer | undefined): void {
    if (pointer === undefined) return;
    if (!this.editCheckpointStore) {
      this.pendingActiveBranch = pointer;
      return;
    }
    this.editCheckpointStore.restoreActiveBranch(this.getSessionId(), pointer);
  }

  /** Apply a stashed active-branch pointer once the store exists (idempotent; clears the stash). */
  private applyPendingActiveBranch(): void {
    if (this.pendingActiveBranch === undefined || !this.editCheckpointStore) return;
    this.editCheckpointStore.restoreActiveBranch(this.getSessionId(), this.pendingActiveBranch);
    this.pendingActiveBranch = undefined;
  }

  async beginEditCheckpointTurn(prompt: string): Promise<void> {
    if (!this.editCheckpointStore) return;
    // SELFHOST-007: apply any stashed --resume branch pointer now (session is ready) so this turn's
    // parent is the restored HEAD, not the last-by-sequence tip.
    this.applyPendingActiveBranch();
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
    // SELFHOST-007: do NOT apply the stashed pointer here — this runs during async init BEFORE the
    // underlying session is assigned, so getSessionId() would throw. It is applied lazily on the first
    // checkpoint operation (beginEditCheckpointTurn / getCheckpointStore), when the session is ready.
  }

  getUsedMemoryReferences(): IMemoryReference[] {
    return [...this.usedMemoryReferences];
  }

  recordMemoryEvent(event: IMemoryEvent): void {
    this.memoryEvents.push(event);
    if (VISIBLE_MEMORY_EVENT_TYPES.has(event.type)) {
      this.history.push({
        id: randomUUID(),
        timestamp: new Date(event.at),
        category: 'event',
        type: 'memory-event',
        data: {
          ...(event as unknown as Record<string, TUniversalValue>),
          message: formatMemoryEventMessage(event),
        },
      });
    }
    this.emitMemoryEvent(event);
    this.persistSession();
  }

  recordSystemContextFiles(entries: readonly IContextFileEntry[]): void {
    this.systemContextReferences = createSystemContextReferenceItems(entries, this.cwd);
  }

  listContextReferences(): IContextReferenceItem[] {
    return [...this.systemContextReferences, ...this.contextReferences];
  }

  listInjectionContextReferences(): IContextReferenceItem[] {
    return [...this.contextReferences];
  }

  async addContextReference(path: string): Promise<IContextReferenceAddResult> {
    const { references, result } = await addInteractiveContextReference(
      this.contextReferences,
      path,
      this.cwd,
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
      this.editCheckpointStore = new EditCheckpointStore({ cwd: this.cwd });
    }
    // SELFHOST-007: apply any stashed --resume branch pointer on first store access (session is ready
    // by the time a read/nav command runs); idempotent — clears the stash once applied.
    this.applyPendingActiveBranch();
    return this.editCheckpointStore;
  }
}
