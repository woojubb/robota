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
