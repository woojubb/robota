import { lstatSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { DEFAULT_BRANCH_ID } from './edit-checkpoint-types.js';
import { workspacePathSegments } from '../workspace-trust/project-reader-path.js';

import type { IEditCheckpointManifest, IEditCheckpointSummary } from './edit-checkpoint-types.js';
import type { IFileSystem, IFileSystemAsync } from '@robota-sdk/agent-core';
import type { ICheckpointNode } from '@robota-sdk/agent-session';

/** A checkpoint directory's manifest, and the directory beside it that holds its pre-images. */
export const MANIFEST_FILE = 'manifest.json';
export const SNAPSHOT_DIR = 'files';
/** What a migration names the sealed copy of a pre-image it stages beside it, before swapping it in. */
export const STAGED_PREIMAGE_SUFFIX = '.sealing';

const ID_PAD = 4;
const TURN_DIRECTORY = /^turn-(\d{4,9})$/u;

/** The highest sequence a checkpoint directory name can carry (`turn-999999999`). */
export const MAX_CHECKPOINT_SEQUENCE = 999_999_999;

/** The directory name, and so the id, of checkpoint `sequence`. */
export function checkpointIdOf(sequence: number): string {
  return `turn-${String(sequence).padStart(ID_PAD, '0')}`;
}

/** The sequence a canonically named turn directory carries; `undefined` for any other name. */
export function sequenceOfDirectory(name: string): number | undefined {
  const digits = TURN_DIRECTORY.exec(name)?.[1];
  if (digits === undefined) return undefined;
  const sequence = Number(digits);
  return checkpointIdOf(sequence) === name ? sequence : undefined;
}

export function toEditCheckpointSummary(manifest: IEditCheckpointManifest): IEditCheckpointSummary {
  return {
    id: manifest.id,
    sessionId: manifest.sessionId,
    sequence: manifest.sequence,
    prompt: manifest.prompt,
    createdAt: manifest.createdAt,
    fileCount: manifest.fileCount,
  };
}

/** The edges of the neutral checkpoint tree, as the manifests record them. */
export function checkpointTreeNodesOf(
  manifests: readonly IEditCheckpointManifest[],
): ICheckpointNode[] {
  return manifests.map((manifest) => ({
    id: manifest.id,
    ...(manifest.parentId !== undefined ? { parentId: manifest.parentId } : {}),
  }));
}

/**
 * A checkpoint manifest named a snapshot that is not inside its own checkpoint directory.
 * The manifest is mutable bytes on disk, not a trusted object: restore re-establishes
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
 * Migration: reconstruct the branch tree for legacy (v1) manifests. A v1 manifest has no
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

/**
 * `absolutePath` relative to the project root `cwd`, or `undefined` when it is the root itself or
 * leaves it. A path leaves the project only when its first segment is exactly `..` or it is anchored
 * elsewhere (another drive or share); a name that merely starts with two dots, such as `..notes`, is
 * an ordinary file inside it.
 */
export function relativeInsideProject(cwd: string, absolutePath: string): string | undefined {
  const relativePath = relative(cwd, absolutePath);
  if (
    relativePath.length === 0 ||
    relativePath.split(sep)[0] === '..' ||
    isAbsolute(relativePath) ||
    resolve(cwd, relativePath) !== absolutePath
  ) {
    return undefined;
  }
  return relativePath;
}

/**
 * Whether `relativePath`, in the project at `cwd`, is the checkpoint state root or lies inside it.
 * Both are read as segments, the way the project reader reads a path, so the spelling of the host's
 * root (`.a\cp` or `.a/cp`) and the separator `node:path` gave `relativePath` do not matter.
 *
 * A name is not an identity: on a volume that ignores case, `.A/CP` and `.a/cp` are one directory. A
 * path spelled the root's way is inside it; one spelled otherwise is inside only when the directory
 * it names at the root's depth is the root itself, as the volume reports it. A different directory
 * is never taken for the root by its name, and a link to the root is not the root.
 */
export function isInsideCheckpointRoot(cwd: string, relativePath: string, root: string): boolean {
  const path = workspacePathSegments(relativePath);
  const rootSegments = workspacePathSegments(root);
  if (path.length < rootSegments.length) return false;
  if (rootSegments.every((segment, index) => path[index] === segment)) return true;
  const atRootDepth = directoryIdentity(join(cwd, ...path.slice(0, rootSegments.length)));
  const rootIdentity = directoryIdentity(join(cwd, ...rootSegments));
  return (
    atRootDepth !== undefined &&
    rootIdentity !== undefined &&
    atRootDepth.ino === rootIdentity.ino &&
    atRootDepth.dev === rootIdentity.dev
  );
}

/**
 * The device and inode of the directory at `path`, or `undefined` when nothing there is a directory
 * the volume gives an identity to: absent, a link (not followed), not a directory, or an inode of 0
 * (a volume that numbers nothing). Windows reports a device of 0 for both sides alike, so its inode
 * is what tells two directories apart there.
 */
function directoryIdentity(path: string): { dev: bigint; ino: bigint } | undefined {
  try {
    const stat = lstatSync(path, { bigint: true });
    return stat.isDirectory() && stat.ino !== 0n ? { dev: stat.dev, ino: stat.ino } : undefined;
  } catch {
    // allow-fallback: a directory that cannot be examined cannot be shown to be the root.
    return undefined;
  }
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
