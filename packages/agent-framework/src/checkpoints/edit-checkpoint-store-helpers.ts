import type { IEditCheckpointManifest } from './edit-checkpoint-types.js';
import type { IFileSystem, IFileSystemAsync } from '@robota-sdk/agent-core';

/** The branch a checkpoint belongs to when a session has not switched away from the default. */
export const DEFAULT_BRANCH_ID = 'main';

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
