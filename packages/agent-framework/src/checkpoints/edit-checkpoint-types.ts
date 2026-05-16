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
  version: 1;
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
