import { isAbsolute, join, relative } from 'node:path';

import type { IEditCheckpointManifest } from './edit-checkpoint-types.js';
import type { IFileSystem, IFileSystemAsync } from '@robota-sdk/agent-core';

/** The branch a checkpoint belongs to when a session has not switched away from the default. */
export const DEFAULT_BRANCH_ID = 'main';

/**
 * A checkpoint manifest named a snapshot that is not inside its own checkpoint directory
 * (issue #2076). The manifest is mutable bytes on disk, not a trusted object: restore re-establishes
 * containment before it deletes, writes or reads anything, and one bad entry aborts the whole
 * restore rather than being skipped.
 */
export class EditCheckpointManifestEscapeError extends Error {
  readonly checkpointDir: string;
  readonly snapshotFile: string;

  constructor(checkpointDir: string, snapshotFile: string) {
    super(
      `Checkpoint manifest names a snapshot outside its checkpoint directory: ${JSON.stringify(snapshotFile)} (checkpoint ${checkpointDir})`,
    );
    this.name = 'EditCheckpointManifestEscapeError';
    this.checkpointDir = checkpointDir;
    this.snapshotFile = snapshotFile;
  }
}

/**
 * The on-disk path of a manifest's snapshot, or a thrown `EditCheckpointManifestEscapeError` when
 * `snapshotFile` is absolute or, joined to `checkpointDir`, is not a STRICT descendant of it — `..`
 * traversal, the directory itself, an empty name. Lexical on purpose: the checkpoint directory is
 * a state-storage path relative to the workspace, and the storage layer canonicalises what it
 * opens; this check is the owner of "which snapshot may a manifest name".
 */
export function resolveContainedSnapshotPath(checkpointDir: string, snapshotFile: string): string {
  if (snapshotFile.length === 0 || isAbsolute(snapshotFile)) {
    throw new EditCheckpointManifestEscapeError(checkpointDir, snapshotFile);
  }
  const joined = join(checkpointDir, snapshotFile);
  const descent = relative(checkpointDir, joined);
  if (
    descent.length === 0 ||
    descent === '..' ||
    descent.startsWith('../') ||
    descent.startsWith('..\\') ||
    isAbsolute(descent)
  ) {
    throw new EditCheckpointManifestEscapeError(checkpointDir, snapshotFile);
  }
  return joined;
}

/**
 * SELFHOST-007 migration: reconstruct the branch tree for legacy (v1) manifests. A v1 manifest has no
 * `parentId`/`branchId`, so — sorted by sequence — it is treated as a LINEAR chain: each node's parent
 * is the previous node, all on the `'main'` branch. v2 manifests keep their stored branch fields. Pure;
 * does not mutate the inputs.
 */
export function migrateManifestsToTree(
  manifests: IEditCheckpointManifest[],
): IEditCheckpointManifest[] {
  return manifests.map((manifest, index) => {
    if (manifest.version === 2 && manifest.branchId !== undefined) return manifest;
    const previous = index > 0 ? manifests[index - 1] : undefined;
    return {
      ...manifest,
      version: 2,
      branchId: DEFAULT_BRANCH_ID,
      ...(previous ? { parentId: previous.id } : {}),
    };
  });
}

export function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function pathExists(
  fsAsync: IFileSystemAsync,
  fs: IFileSystem,
  path: string,
): Promise<boolean> {
  try {
    await fsAsync.access(path, fs.constants.F_OK);
    return true;
  } catch {
    // allow-fallback: access failure means file absent, false is the correct result
    return false;
  }
}
