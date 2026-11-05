import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import {
  OWNER_ONLY_FILE_MODE,
  assertUnlinkedOwnerDirectory,
  createProcessMarkers,
  ensureOwnerOnlyDirectory,
  writeOwnerOnlyFile,
} from '@robota-sdk/agent-core/node';

import {
  refuseProjectRead,
  workspacePathSegments,
} from '../workspace-trust/project-reader-path.js';

import type { IProcessMarkerHandle } from '@robota-sdk/agent-core';
import type {
  IWorkspaceProjectStateStorage,
  IWorkspaceDirectoryEntry,
  TWorkspaceContributionKind,
} from '../workspace-trust/index.js';

/**
 * Where an edit checkpoint store keeps its manifests and file pre-images, as a location only: the
 * store seals what it writes there, or not, as its own `sealing` says. The project's trusted state
 * directory is one answer (`IWorkspaceProjectStateStorage` satisfies this); a directory outside the
 * project is the other ({@link createDirectoryEditCheckpointState}).
 */
export interface IEditCheckpointStateStorage {
  /**
   * The project-relative root the state sits under; absent when it is held outside the project, where
   * an edit can never land inside it.
   */
  readonly rootRelativePath?: string;
  /**
   * True for the state a store makes from its `sealing` when that seals; the store then holds itself
   * to the rules of sealed checkpoints. A store refuses state given to it that already says so, since
   * it applies its own sealing. Absent: plain.
   */
  readonly seals?: boolean;
  readText(relativePath: string, purpose: string): string | undefined;
  readBytes(relativePath: string, purpose: string): Uint8Array | undefined;
  /** Acquire the sole checkpoint writer for a session, or return undefined while another holds it. */
  acquireTurn?(sessionId: string, purpose: string): IProcessMarkerHandle | undefined;
  /** Claim a new checkpoint directory atomically; false means it already exists as a plain directory. */
  claimDirectory?(relativePath: string, purpose: string): boolean;
  writeText(relativePath: string, content: string, purpose: string): void;
  writeBytes(relativePath: string, content: Uint8Array, purpose: string): void;
  /**
   * Replaces the file whole, so a failure before the new content is in place leaves the previous
   * file, or none, never a torn one. Sealed state writes its manifests through it.
   */
  replaceBytes(relativePath: string, content: Uint8Array, purpose: string): void;
  listDirectory(relativePath: string, purpose: string): readonly IWorkspaceDirectoryEntry[];
}

const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
const WRITE_FLAGS =
  constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);

function isAbsent(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function entryKind(entry: {
  isSymbolicLink(): boolean;
  isFile(): boolean;
  isDirectory(): boolean;
}): TWorkspaceContributionKind {
  if (entry.isSymbolicLink()) return 'link';
  if (entry.isFile()) return 'file';
  if (entry.isDirectory()) return 'directory';
  return 'other';
}

class DirectoryEditCheckpointState implements IEditCheckpointStateStorage {
  constructor(private readonly root: string) {
    ensureOwnerOnlyDirectory(root);
  }

  readText(relativePath: string, purpose: string): string | undefined {
    const bytes = this.readBytes(relativePath, purpose);
    return bytes === undefined ? undefined : Buffer.from(bytes).toString('utf8');
  }

  readBytes(relativePath: string, _purpose: string): Uint8Array | undefined {
    let descriptor: number;
    try {
      descriptor = openSync(this.resolve(relativePath), READ_FLAGS);
    } catch (error) {
      if (isAbsent(error)) return undefined;
      throw error;
    }
    try {
      if (!fstatSync(descriptor).isFile()) {
        refuseProjectRead('Checkpoint state entry is not a file.');
      }
      return readFileSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }

  acquireTurn(sessionId: string, _purpose: string): IProcessMarkerHandle | undefined {
    const directory = this.resolve(join(sessionId, '.writer'));
    assertUnlinkedOwnerDirectory(directory, this.root);
    const result = createProcessMarkers(directory).acquire('active');
    return result.status === 'acquired' ? result.handle : undefined;
  }

  claimDirectory(relativePath: string, _purpose: string): boolean {
    const path = this.resolve(relativePath);
    ensureOwnerOnlyDirectory(dirname(path), { withinRoot: this.root, rejectSymlinks: true });
    try {
      mkdirSync(path, { mode: 0o700 });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const metadata = lstatSync(path, { throwIfNoEntry: false });
      if (metadata !== undefined && !metadata.isDirectory()) {
        refuseProjectRead('A checkpoint directory claim collided with a non-directory.');
      }
      return false;
    }
  }

  writeText(relativePath: string, content: string, purpose: string): void {
    this.writeBytes(relativePath, Buffer.from(content), purpose);
  }

  writeBytes(relativePath: string, content: Uint8Array, _purpose: string): void {
    const path = this.resolve(relativePath);
    ensureOwnerOnlyDirectory(dirname(path), { withinRoot: this.root });
    const descriptor = openSync(path, WRITE_FLAGS, OWNER_ONLY_FILE_MODE);
    try {
      writeFileSync(descriptor, content);
    } finally {
      closeSync(descriptor);
    }
  }

  /** Flushed to a temp file beside the target and renamed over it, then the directory flushed. */
  replaceBytes(relativePath: string, content: Uint8Array, _purpose: string): void {
    const path = this.resolve(relativePath);
    ensureOwnerOnlyDirectory(dirname(path), { withinRoot: this.root });
    writeOwnerOnlyFile(path, content, { durable: true });
  }

  listDirectory(relativePath: string, _purpose: string): readonly IWorkspaceDirectoryEntry[] {
    try {
      return readdirSync(this.resolve(relativePath, true), { withFileTypes: true }).map(
        (entry) => ({ name: entry.name, kind: entryKind(entry) }),
      );
    } catch (error) {
      if (isAbsent(error)) return [];
      throw error;
    }
  }

  private resolve(relativePath: string, allowRoot = false): string {
    return join(this.root, ...workspacePathSegments(relativePath, allowRoot));
  }
}

/**
 * Checkpoint state held in `root`, a directory the caller owns for as long as the state should live.
 * `root` and everything under it is owner-only (`0700` directories, `0600` files); the caller removes
 * it when the state is no longer wanted.
 */
export function createDirectoryEditCheckpointState(root: string): IEditCheckpointStateStorage {
  return new DirectoryEditCheckpointState(root);
}

/** Bind the project authority's state facet to its per-session checkpoint writer markers. */
export function createProjectEditCheckpointState(storage: IWorkspaceProjectStateStorage): IEditCheckpointStateStorage {
  return {
    rootRelativePath: storage.rootRelativePath,
    acquireTurn: (sessionId, purpose) => {
      if (storage.acquireWriter === undefined) throw new Error('The project host must support checkpoint writer leases.');
      return storage.acquireWriter(join(sessionId, '.writer'), purpose);
    },
    claimDirectory: (path, purpose) => {
      if (storage.claimDirectory === undefined) throw new Error('Checkpoint storage must support atomic directory claims.');
      return storage.claimDirectory(path, purpose);
    },
    readText: (path, purpose) => storage.readText(path, purpose),
    readBytes: (path, purpose) => storage.readBytes(path, purpose),
    writeText: (path, content, purpose) => storage.writeText(path, content, purpose),
    writeBytes: (path, content, purpose) => storage.writeBytes(path, content, purpose),
    replaceBytes: (path, content, purpose) => storage.replaceBytes(path, content, purpose),
    listDirectory: (path, purpose) => storage.listDirectory(path, purpose),
  };
}
