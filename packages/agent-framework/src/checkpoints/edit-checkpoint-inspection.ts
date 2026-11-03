import { relative } from 'node:path';

import { toEditCheckpointSummary as toSummary } from './edit-checkpoint-store-helpers.js';

import type { TEditCheckpointUnreadableReason } from './edit-checkpoint-errors.js';
import type {
  IEditCheckpointFileRecord,
  IEditCheckpointInspection,
  IEditCheckpointInspectionPlan,
  IEditCheckpointManifest,
} from './edit-checkpoint-types.js';

/** What inspecting says of one captured file's pre-image. */
export interface IEditCheckpointSnapshotState {
  available: boolean;
  sizeBytes?: number;
  /** The size is the one recorded at capture, not measured from the stored pre-image. */
  recorded?: boolean;
}

/** A checkpoint of the session that does not open, by its directory's sequence. */
export interface IUnreadableEditCheckpoint {
  readonly id: string;
  readonly sequence: number;
  readonly reason: TEditCheckpointUnreadableReason;
}

interface IEditCheckpointInspectionInput {
  cwd: string;
  target: IEditCheckpointManifest;
  manifests: readonly IEditCheckpointManifest[];
  /** The checkpoints that do not open; one inside a plan's range would refuse it. */
  unreadable: readonly IUnreadableEditCheckpoint[];
  inspectSnapshot: (file: IEditCheckpointFileRecord) => IEditCheckpointSnapshotState;
}

export function buildEditCheckpointInspection(
  input: IEditCheckpointInspectionInput,
): IEditCheckpointInspection {
  const later = input.manifests.filter((manifest) => manifest.sequence > input.target.sequence);
  const rollbackRange = input.manifests.filter(
    (manifest) => manifest.sequence >= input.target.sequence,
  );
  const blockedBy = refusingCheckpoint(input.unreadable, input.target.sequence);

  return {
    target: toSummary(input.target),
    capturedFiles: input.target.files.map((file) => {
      const snapshot = input.inspectSnapshot(file);
      return {
        originalPath: file.originalPath,
        relativePath: relative(input.cwd, file.originalPath),
        existed: file.existed,
        restoreAction: file.existed ? 'restore-preimage' : 'delete-created-file',
        snapshotAvailable: snapshot.available,
        ...(snapshot.sizeBytes !== undefined ? { snapshotSizeBytes: snapshot.sizeBytes } : {}),
        ...(snapshot.recorded === true ? { snapshotSizeSource: 'recorded' as const } : {}),
      };
    }),
    restoreToCheckpoint: toInspectionPlan(later, blockedBy),
    rollbackThroughCheckpoint: toInspectionPlan(rollbackRange, blockedBy),
  };
}

/**
 * The checkpoint that refuses a restore or rollback of everything after `sequence`: the latest one
 * that does not open, since restoring to any checkpoint after it still works.
 */
export function refusingCheckpoint(
  unreadable: readonly IUnreadableEditCheckpoint[],
  sequence: number,
): IUnreadableEditCheckpoint | undefined {
  return unreadable
    .filter((checkpoint) => checkpoint.sequence > sequence)
    .reduce<IUnreadableEditCheckpoint | undefined>(
      (latest, checkpoint) =>
        latest === undefined || checkpoint.sequence > latest.sequence ? checkpoint : latest,
      undefined,
    );
}

function toInspectionPlan(
  manifests: readonly IEditCheckpointManifest[],
  blockedBy: IUnreadableEditCheckpoint | undefined,
): IEditCheckpointInspectionPlan {
  return {
    checkpointIds: manifests.map((manifest) => manifest.id),
    fileCount: manifests.reduce((count, manifest) => count + manifest.fileCount, 0),
    ...(blockedBy === undefined
      ? {}
      : { blockedBy: { checkpointId: blockedBy.id, reason: blockedBy.reason } }),
  };
}
