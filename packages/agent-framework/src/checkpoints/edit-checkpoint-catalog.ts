/**
 * How an edit checkpoint store finds, reads and restores its checkpoints. The store keeps what every
 * kind of state shares — the branch head, restore planning and containment — and asks its catalog for
 * the rest: plain state as it always was ({@link PlainEditCheckpointCatalog}), or sealed state under
 * the rules of sealed checkpoints (`SealedEditCheckpointCatalog`).
 */
import { join } from 'node:path';

import { CheckpointTree } from '@robota-sdk/agent-session';

import {
  MANIFEST_FILE,
  checkpointTreeNodesOf,
  migrateManifestsToTree,
  resolveContainedSnapshotPath,
} from './edit-checkpoint-store-helpers.js';

import type { EditCheckpointAuthorityIO } from './edit-checkpoint-authority-io.js';
import type {
  IEditCheckpointSnapshotState,
  IUnreadableEditCheckpoint,
} from './edit-checkpoint-inspection.js';
import type {
  IEditCheckpointFileRecord,
  IEditCheckpointManifest,
} from './edit-checkpoint-types.js';

/** One entry of a restore: a file to write back or delete, and where its pre-image is kept. */
export interface IRestorePlanEntry {
  readonly checkpointId: string;
  /** The file's project-relative path, which tells the entries that write one file apart. */
  readonly projectPath: string;
  readonly snapshotPath: string | undefined;
  readonly record: IEditCheckpointFileRecord;
}

/** The checkpoints a read can use, and those that do not open. */
export interface IReadableCheckpoints {
  readonly manifests: IEditCheckpointManifest[];
  /** Ids of the manifests that were sealed; their pre-images must be sealed too. */
  readonly sealedIds: ReadonlySet<string>;
  readonly unreadable: IUnreadableEditCheckpoint[];
}

export interface IEditCheckpointCatalog {
  /**
   * The sequence the session's next checkpoint takes, and the checkpoint a turn continues when no
   * branch head says otherwise.
   */
  next(sessionDir: string): { readonly sequence: number; readonly latestId: string | undefined };
  /**
   * The session's checkpoints as a person's read sees them; throws `EditCheckpointsLockedError`
   * when they cannot be opened now.
   */
  read(sessionId: string, sessionDir: string): IReadableCheckpoints;
  /** Whether a resumed branch pointer names a checkpoint of the session. */
  pointsAt(sessionDir: string, checkpointId: string): boolean;
  /** What inspecting `target`, kept in `checkpointDir`, says of each captured file's pre-image. */
  inspector(
    target: IEditCheckpointManifest,
    checkpointDir: string,
    checkpoints: IReadableCheckpoints,
  ): (file: IEditCheckpointFileRecord) => IEditCheckpointSnapshotState;
  /** Writes `plan` (latest checkpoint first) back to the project; returns how many entries it restored. */
  restore(
    plan: readonly IRestorePlanEntry[],
    checkpoints: IReadableCheckpoints,
    target: IEditCheckpointManifest,
  ): number;
}

/** Plain checkpoint state, read and restored exactly as every earlier build did. */
export class PlainEditCheckpointCatalog implements IEditCheckpointCatalog {
  constructor(private readonly io: EditCheckpointAuthorityIO) {}

  next(sessionDir: string): { readonly sequence: number; readonly latestId: string | undefined } {
    const latest = this.load(sessionDir).at(-1);
    return { sequence: (latest?.sequence ?? 0) + 1, latestId: latest?.id };
  }

  read(_sessionId: string, sessionDir: string): IReadableCheckpoints {
    return { manifests: this.load(sessionDir), sealedIds: new Set(), unreadable: [] };
  }

  pointsAt(sessionDir: string, checkpointId: string): boolean {
    return CheckpointTree.fromNodes(checkpointTreeNodesOf(this.load(sessionDir))).has(checkpointId);
  }

  /** The pre-image is read, and its size measured. */
  inspector(
    _target: IEditCheckpointManifest,
    checkpointDir: string,
  ): (file: IEditCheckpointFileRecord) => IEditCheckpointSnapshotState {
    return (file) => {
      const snapshot = file.snapshotFile
        ? this.io.readSnapshotBytes(resolveContainedSnapshotPath(checkpointDir, file.snapshotFile))
        : undefined;
      return {
        available: file.existed ? snapshot !== undefined : false,
        ...(snapshot ? { sizeBytes: snapshot.byteLength } : {}),
      };
    };
  }

  restore(plan: readonly IRestorePlanEntry[]): number {
    for (const entry of plan) {
      this.io.restoreFile(entry.snapshotPath, entry.record);
    }
    return plan.length;
  }

  private load(sessionDir: string): IEditCheckpointManifest[] {
    const manifests = this.io
      .listDirectories(sessionDir)
      .map((entry) => join(sessionDir, entry, MANIFEST_FILE))
      .map((manifestPath) => this.io.readManifest(manifestPath))
      .filter((manifest): manifest is IEditCheckpointManifest => manifest !== undefined)
      .sort((a, b) => a.sequence - b.sequence);
    return migrateManifestsToTree(manifests);
  }
}
