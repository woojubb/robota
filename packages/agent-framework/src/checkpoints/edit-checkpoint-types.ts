import type { IActiveBranchPointer } from '@robota-sdk/agent-interface-session';

export interface IEditCheckpointRecorder {
  captureFile(filePath: string): Promise<void> | void;
}

export interface IEditCheckpointTurnInput {
  sessionId: string;
  prompt: string;
}

export interface IEditCheckpointSummary {
  id: string;
  sessionId: string;
  sequence: number;
  prompt: string;
  createdAt: string;
  fileCount: number;
}

export interface IEditCheckpointFileRecord {
  originalPath: string;
  existed: boolean;
  snapshotFile?: string;
  /** The pre-image's size when it was captured, recorded by a store whose state seals. */
  byteLength?: number;
}

export interface IEditCheckpointManifest extends IEditCheckpointSummary {
  /**
   * SELFHOST-007: `1` = legacy linear manifest (no branch fields; migrated to a linear chain on load).
   * `2` = branch-aware manifest carrying `parentId`/`branchId`.
   */
  version: 1 | 2;
  /**
   * SELFHOST-007: id of the checkpoint this one was created after (its parent in the branch tree).
   * Absent on the root and on legacy (v1) manifests — a v1 chain is reconstructed linearly by sequence.
   */
  parentId?: string;
  /** SELFHOST-007: the branch line this checkpoint belongs to (default `'main'`). */
  branchId?: string;
  files: IEditCheckpointFileRecord[];
}

export type TEditCheckpointFileRestoreAction = 'restore-preimage' | 'delete-created-file';

export interface IEditCheckpointFileInspection {
  originalPath: string;
  relativePath: string;
  existed: boolean;
  restoreAction: TEditCheckpointFileRestoreAction;
  snapshotAvailable: boolean;
  snapshotSizeBytes?: number;
  /** `recorded`: the size is the one recorded at capture, not measured from the stored pre-image. */
  snapshotSizeSource?: 'recorded';
}

export interface IEditCheckpointInspectionPlan {
  checkpointIds: string[];
  fileCount: number;
  /** A checkpoint in the range that does not open, so the restore or rollback would be refused. */
  blockedBy?: { checkpointId: string; reason: 'damaged' | 'newer' };
}

/** How many of a session's edit checkpoints do not open, by why; `list` leaves them out. */
export interface IEditCheckpointUnreadableCounts {
  damaged: number;
  newer: number;
}

/** A session's edit checkpoints that open, and how many do not, from one read. */
export interface IEditCheckpointListing {
  checkpoints: IEditCheckpointSummary[];
  unreadable: IEditCheckpointUnreadableCounts;
}

export interface IEditCheckpointInspection {
  target: IEditCheckpointSummary;
  capturedFiles: IEditCheckpointFileInspection[];
  restoreToCheckpoint: IEditCheckpointInspectionPlan;
  rollbackThroughCheckpoint: IEditCheckpointInspectionPlan;
}

export interface IEditCheckpointRestoreResult {
  target: IEditCheckpointSummary;
  restoredCheckpointCount: number;
  restoredFileCount: number;
  removedCheckpointCount: number;
}

/** The branch a checkpoint belongs to when a session has not switched away from the default. */
export const DEFAULT_BRANCH_ID = 'main';

/**
 * What a session asks of its edit checkpoint store: record each turn's pre-images, list, inspect,
 * restore and branch them, and keep the active branch across a resume. The framework's own store,
 * `EditCheckpointStore` from `@robota-sdk/agent-framework/node`, keeps them in a project's files; a
 * host that keeps them elsewhere implements this and passes it as `editCheckpointStore`. Absent, the
 * session has no checkpoints and says why.
 */
export interface IEditCheckpointStore extends IEditCheckpointRecorder {
  beginTurn(input: IEditCheckpointTurnInput): Promise<IEditCheckpointSummary>;
  finalizeTurn(): Promise<IEditCheckpointSummary | undefined>;
  list(sessionId: string): IEditCheckpointSummary[];
  /** How many of the session's checkpoints `list` leaves out because they do not open. */
  countUnreadable(sessionId: string): IEditCheckpointUnreadableCounts;
  /** What `list` and `countUnreadable` answer, from one read of the session's checkpoints. */
  listing(sessionId: string): IEditCheckpointListing;
  inspect(sessionId: string, checkpointId: string): IEditCheckpointInspection;
  restoreToCheckpoint(
    sessionId: string,
    checkpointId: string,
  ): Promise<IEditCheckpointRestoreResult>;
  rollbackThroughCheckpoint(
    sessionId: string,
    checkpointId: string,
  ): Promise<IEditCheckpointRestoreResult>;
  /** The branch tips (leaf checkpoints) of the session's checkpoint tree. */
  listCheckpointBranches(sessionId: string): string[];
  /** The ancestors of a checkpoint, nearest first to the root. */
  checkpointAncestors(sessionId: string, checkpointId: string): string[];
  /** Switch the active branch to an existing checkpoint, so the next turn continues that line. */
  switchToCheckpoint(sessionId: string, checkpointId: string): void;
  /** The active-branch pointer to persist on the session record; undefined before any head. */
  getActiveBranchPointer(sessionId: string): IActiveBranchPointer | undefined;
  /** Restore a persisted pointer; one that no longer points at a checkpoint is ignored. */
  restoreActiveBranch(sessionId: string, pointer: IActiveBranchPointer | undefined): void;
}
