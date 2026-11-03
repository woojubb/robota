import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { OWNER_ONLY_FILE_MODE, ensureOwnerOnlyDirectory } from '@robota-sdk/agent-core/node';

import { workspacePathSegments } from '../workspace-trust/project-reader-path.js';

import type {
  IWorkspaceDirectoryEntry,
  TWorkspaceContributionKind,
} from '../workspace-trust/index.js';

/**
 * Where an edit checkpoint store keeps its manifests and file pre-images. The project's trusted state
 * directory is one answer (`IWorkspaceProjectStateStorage` satisfies this); a directory outside the
 * project is the other ({@link createDirectoryEditCheckpointState}).
 */
export interface IEditCheckpointStateStorage {
  /**
   * The project-relative root the state sits under; absent when it is held outside the project, where
   * an edit can never land inside it.
   */
  readonly rootRelativePath?: string;
  readText(relativePath: string, purpose: string): string | undefined;
  readBytes(relativePath: string, purpose: string): Uint8Array | undefined;
  writeText(relativePath: string, content: string, purpose: string): void;
  writeBytes(relativePath: string, content: Uint8Array, purpose: string): void;
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
      if (!fstatSync(descriptor).isFile()) throw new Error('Checkpoint state entry is not a file.');
      return readFileSync(descriptor);
    } finally {
      closeSync(descriptor);
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
