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
}

export interface IEditCheckpointInspectionPlan {
  checkpointIds: string[];
  fileCount: number;
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
