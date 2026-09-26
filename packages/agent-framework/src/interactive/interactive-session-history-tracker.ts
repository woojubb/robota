import { randomUUID } from 'node:crypto';

import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';

import {
  addInteractiveContextReference,
  createSystemContextReferenceItems,
  recordInteractiveContextReferences,
} from './interactive-session-context-references.js';
import { SessionBranchEvents } from './session-branch-events.js';
import { formatSkillActivationMessage } from '../commands/skill-activation-events.js';
import {
  clearContextReferences,
  removeContextReference,
} from '../context/context-reference-inventory.js';
import {
  VISIBLE_MEMORY_EVENT_TYPES,
  formatMemoryEventMessage,
} from '../memory/memory-event-format.js';
import { EditCheckpointsUnavailableError } from '../checkpoints/edit-checkpoints-unavailable-error.js';
import { supportsWorkspaceProjectMutation } from '../workspace-trust/index.js';

import type { IHistoryTrackerState } from './session-history-state.js';
import type { EditCheckpointStore } from '../checkpoints/edit-checkpoint-store.js';
import type { TEditCheckpointsUnavailableReason } from '../checkpoints/edit-checkpoints-unavailable-error.js';
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
import type { IWorkspacePolicy } from '../workspace-trust/index.js';
import type { IHistoryEntry, TUniversalValue } from '@robota-sdk/agent-core';
import type { IActiveBranchPointer, IBranchEvent } from '@robota-sdk/agent-interface-session';
export { BRANCH_OPERATION_EVENT_MATRIX } from './session-branch-events.js';
export type { IHistoryTrackerState } from './session-history-state.js';

export class SessionHistoryTracker {
  private history: IHistoryEntry[] = [];
  private editCheckpointStore: EditCheckpointStore | null = null;
  private readonly branchEvents: SessionBranchEvents;
  /**
   * SELFHOST-007: a persisted active-branch pointer restored on resume, before the session (and
   * possibly the store) exists — stashed here and applied on the first checkpoint operation, so
   * `--resume` reaches the store instead of throwing or silently dropping the pointer.
   */
  private pendingActiveBranch: IActiveBranchPointer | undefined = undefined;
  private memoryEvents: IMemoryEvent[] = [];
  private usedMemoryReferences: IMemoryReference[] = [];
  private contextReferences: IContextReferenceItem[] = [];
  private systemContextReferences: IContextReferenceItem[] = [];
  private skillActivationEvents: ISkillActivationEvent[] = [];

  constructor(
    private readonly workspace: IWorkspacePolicy,
    private readonly getSessionId: () => string,
    private readonly getExecuting: () => boolean,
    private readonly persistSession: () => void,
    private readonly emitSkillActivation: (event: ISkillActivationEvent) => void,
    private readonly emitMemoryEvent: (event: IMemoryEvent) => void,
    editCheckpointStore: EditCheckpointStore | null = null,
    emitBranchEvent: (event: IBranchEvent) => void = () => undefined,
  ) {
    this.editCheckpointStore = editCheckpointStore;
    this.branchEvents = new SessionBranchEvents(
      () => this.getCheckpointStore(),
      getSessionId,
      persistSession,
      emitBranchEvent,
      (error) =>
        this.history.push(
          messageToHistoryEntry(createSystemMessage(`Checkpoint error: ${error.message}`)),
        ),
    );
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
    this.branchEvents.emit('restore', checkpointId);
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
    this.branchEvents.emit('rollback', checkpointId);
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
    this.branchEvents.emit('fork', checkpointId);
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
    this.branchEvents.emit('switch', checkpointId);
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
   * SELFHOST-007: restore the active branch from a persisted pointer on resume (graceful on drift).
   * The pointer is always stashed and applied on the first checkpoint operation: on the standard
   * path a resume restores its record before the underlying session exists, so the session id the
   * store keys by cannot be read yet, whether or not the store was given at construction.
   */
  restoreActiveBranch(pointer: IActiveBranchPointer | undefined): void {
    if (pointer === undefined) return;
    this.pendingActiveBranch = pointer;
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
    if (this.editCheckpointStore) await this.branchEvents.finalize();
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

  recordUsedMemoryReferences(references: readonly IMemoryReference[]): void {
    if (references.length === 0) return;
    this.usedMemoryReferences = [...this.usedMemoryReferences, ...references];
    this.persistSession();
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
    this.systemContextReferences = createSystemContextReferenceItems(entries, this.workspace.cwd);
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
      this.workspace.projectAccess,
      this.workspace.cwd,
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
    if (!this.editCheckpointStore) throw new EditCheckpointsUnavailableError(this.noStoreReason());
    this.applyPendingActiveBranch();
    return this.editCheckpointStore;
  }

  /**
   * The host is checked first: where no project write can be proven safe, trusting the workspace
   * would not bring checkpoints back, so naming trust there would send the user the wrong way.
   */
  private noStoreReason(): TEditCheckpointsUnavailableReason {
    if (!supportsWorkspaceProjectMutation()) return 'host-cannot-write-project';
    if (this.workspace.projectAccess.status !== 'trusted') return 'restricted-workspace';
    return 'no-checkpoint-store';
  }
}
