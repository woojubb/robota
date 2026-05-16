import { join, relative } from 'node:path';
import type { IFileSystem } from '@robota-sdk/agent-core';
import { NodeFileSystem } from '../adapters/node-file-system.js';
import type {
  IEditCheckpointInspection,
  IEditCheckpointInspectionPlan,
  IEditCheckpointManifest,
  IEditCheckpointSummary,
} from './edit-checkpoint-types.js';

interface IEditCheckpointInspectionInput {
  cwd: string;
  sessionId: string;
  target: IEditCheckpointManifest;
  manifests: readonly IEditCheckpointManifest[];
  checkpointDir: (sessionId: string, checkpointId: string) => string;
  fs?: IFileSystem;
}

export function buildEditCheckpointInspection(
  input: IEditCheckpointInspectionInput,
): IEditCheckpointInspection {
  const fs = input.fs ?? new NodeFileSystem();
  const later = input.manifests.filter((manifest) => manifest.sequence > input.target.sequence);
  const rollbackRange = input.manifests.filter(
    (manifest) => manifest.sequence >= input.target.sequence,
  );

  return {
    target: toSummary(input.target),
    capturedFiles: input.target.files.map((file) => {
      const snapshotPath = file.snapshotFile
        ? join(input.checkpointDir(input.sessionId, input.target.id), file.snapshotFile)
        : undefined;
      const snapshotStats = snapshotPath ? statSafe(snapshotPath, fs) : undefined;
      return {
        originalPath: file.originalPath,
        relativePath: relative(input.cwd, file.originalPath),
        existed: file.existed,
        restoreAction: file.existed ? 'restore-preimage' : 'delete-created-file',
        snapshotAvailable: file.existed ? snapshotStats !== undefined : false,
        ...(snapshotStats ? { snapshotSizeBytes: snapshotStats.size } : {}),
      };
    }),
    restoreToCheckpoint: toInspectionPlan(later),
    rollbackThroughCheckpoint: toInspectionPlan(rollbackRange),
  };
}

function toSummary(manifest: IEditCheckpointManifest): IEditCheckpointSummary {
  return {
    id: manifest.id,
    sessionId: manifest.sessionId,
    sequence: manifest.sequence,
    prompt: manifest.prompt,
    createdAt: manifest.createdAt,
    fileCount: manifest.fileCount,
  };
}

function toInspectionPlan(
  manifests: readonly IEditCheckpointManifest[],
): IEditCheckpointInspectionPlan {
  return {
    checkpointIds: manifests.map((manifest) => manifest.id),
    fileCount: manifests.reduce((count, manifest) => count + manifest.fileCount, 0),
  };
}

function statSafe(path: string, fs: IFileSystem): { size: number } | undefined {
  try {
    return fs.statSync(path);
  } catch {
    // allow-fallback: missing snapshot file returns undefined to mark snapshot unavailable
    return undefined;
  }
}
