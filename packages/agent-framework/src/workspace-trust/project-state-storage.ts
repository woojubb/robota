import { lstatSync } from 'node:fs';
import { join, sep } from 'node:path';

import { assertProjectReadPurpose, workspacePathSegments } from './project-reader-path.js';
import { createWorkspaceProjectMutationBoundary } from './project-relative-writer.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';
import {
  assertWorkspaceProjectAuthority,
  getWorkspaceProjectIdentity,
  getWorkspaceProjectIdentityResolver,
  getWorkspaceProjectReader,
  getWorkspaceProjectStateDirectories,
} from './workspace-authority.js';

import type { IWorkspaceProjectMutationBoundary } from './project-relative-writer.js';
import type {
  IWorkspaceDirectoryEntry,
  IWorkspaceProjectAuthority,
  IWorkspaceProjectReader,
  IWorkspaceProjectStateStorage,
  TWorkspaceProjectAuthorityCandidate,
  TWorkspaceProjectStateNamespace,
} from './types.js';

const projectStateStorages = new WeakMap<object, IWorkspaceProjectAuthority>();
/** The anchored writer behind each minted storage, and its path resolution; internal to the framework. */
interface IMigrationAccess {
  readonly boundary: IWorkspaceProjectMutationBoundary;
  readonly projectRelativePath: (relativePath: string, allowRoot: boolean) => string;
  /** The trusted root the storage's paths are relative to. */
  readonly worktreeRoot: string;
}

/** What a store's migration does with a minted storage beyond the public facet. */
const migrationAccesses = new WeakMap<object, IMigrationAccess>();

class WorkspaceProjectStateStorage {
  readonly namespace: TWorkspaceProjectStateNamespace;
  readonly rootRelativePath: string;

  constructor(
    namespace: TWorkspaceProjectStateNamespace,
    rootRelativePath: string,
    private readonly authority: IWorkspaceProjectAuthority,
    private readonly reader: IWorkspaceProjectReader,
    private readonly mutationBoundary: IWorkspaceProjectMutationBoundary,
  ) {
    this.namespace = namespace;
    this.rootRelativePath = rootRelativePath;
  }

  readText(relativePath: string, purpose: string): string | undefined {
    assertWorkspaceProjectAuthority(this.authority);
    return this.reader.readText(this.projectRelativePath(relativePath), purpose);
  }

  readBytes(relativePath: string, purpose: string, maxBytes?: number): Uint8Array | undefined {
    assertWorkspaceProjectAuthority(this.authority);
    return this.reader.readBytes(this.projectRelativePath(relativePath), purpose, maxBytes);
  }

  writeText(relativePath: string, content: string, purpose: string): void {
    assertWorkspaceProjectAuthority(this.authority);
    this.writeBytes(relativePath, Buffer.from(content), purpose);
  }

  writeBytes(relativePath: string, content: Uint8Array, purpose: string): void {
    assertWorkspaceProjectAuthority(this.authority);
    assertProjectReadPurpose(purpose);
    this.mutationBoundary.write(this.projectRelativePath(relativePath), content);
  }

  replaceBytes(relativePath: string, content: Uint8Array, purpose: string): void {
    assertWorkspaceProjectAuthority(this.authority);
    assertProjectReadPurpose(purpose);
    this.mutationBoundary.replace(this.projectRelativePath(relativePath), content);
  }

  appendText(relativePath: string, content: string, purpose: string): void {
    assertWorkspaceProjectAuthority(this.authority);
    assertProjectReadPurpose(purpose);
    this.mutationBoundary.append(this.projectRelativePath(relativePath), content);
  }

  listDirectory(relativePath: string, purpose: string): readonly IWorkspaceDirectoryEntry[] {
    assertWorkspaceProjectAuthority(this.authority);
    return this.reader.listDirectory(this.projectRelativePath(relativePath, true), purpose);
  }

  deleteFile(relativePath: string, purpose: string): boolean {
    assertWorkspaceProjectAuthority(this.authority);
    assertProjectReadPurpose(purpose);
    return this.mutationBoundary.delete(this.projectRelativePath(relativePath));
  }

  projectRelativePath(relativePath: string, allowRoot = false): string {
    assertWorkspaceProjectAuthority(this.authority);
    const segments = workspacePathSegments(relativePath, allowRoot);
    return segments.length === 0
      ? this.rootRelativePath
      : join(this.rootRelativePath, segments.join(sep));
  }
}

export function getWorkspaceProjectStateStorage(
  authority: IWorkspaceProjectAuthority,
  namespace: TWorkspaceProjectStateNamespace,
): IWorkspaceProjectStateStorage {
  const accepted = assertWorkspaceProjectAuthority(authority);
  const rootRelativePath = getWorkspaceProjectStateDirectories(accepted)[namespace];
  if (typeof rootRelativePath !== 'string') {
    throw new WorkspaceAuthorityRequiredError('Unknown project state namespace.');
  }
  const identity = getWorkspaceProjectIdentity(accepted);
  const reader = getWorkspaceProjectReader(accepted);
  const mutationBoundary = createWorkspaceProjectMutationBoundary(
    identity,
    getWorkspaceProjectIdentityResolver(accepted),
  );
  const storage = Object.freeze(
    new WorkspaceProjectStateStorage(
      namespace,
      rootRelativePath,
      accepted,
      reader,
      mutationBoundary,
    ),
  );
  projectStateStorages.set(storage, accepted);
  migrationAccesses.set(storage, {
    boundary: mutationBoundary,
    projectRelativePath: (relativePath, allowRoot) =>
      storage.projectRelativePath(relativePath, allowRoot),
    worktreeRoot: identity.worktreeRoot,
  });
  return storage as IWorkspaceProjectStateStorage;
}

export function assertWorkspaceProjectStateStorage(
  candidate: TWorkspaceProjectAuthorityCandidate,
): IWorkspaceProjectStateStorage {
  if (
    (typeof candidate !== 'object' && typeof candidate !== 'function') ||
    candidate === null ||
    !projectStateStorages.has(candidate)
  ) {
    throw new WorkspaceAuthorityRequiredError(
      'A runtime-minted workspace project state storage is required.',
    );
  }
  assertWorkspaceProjectAuthority(projectStateStorages.get(candidate)!);
  return candidate as IWorkspaceProjectStateStorage;
}

/** Internal check for multi-namespace adapters that must stay within one exact grant. */
export function assertWorkspaceProjectStateStoragePair(
  left: IWorkspaceProjectStateStorage,
  right: IWorkspaceProjectStateStorage,
): void {
  const acceptedLeft = assertWorkspaceProjectStateStorage(left);
  const acceptedRight = assertWorkspaceProjectStateStorage(right);
  if (projectStateStorages.get(acceptedLeft) !== projectStateStorages.get(acceptedRight)) {
    throw new WorkspaceAuthorityRequiredError(
      'Project state facets do not belong to the same workspace authority.',
    );
  }
}

/** The anchored writer behind a minted storage, with its authority checked to be live. */
function migrationAccessOf(storage: IWorkspaceProjectStateStorage): IMigrationAccess {
  const access = migrationAccesses.get(assertWorkspaceProjectStateStorage(storage));
  if (access === undefined) {
    throw new WorkspaceAuthorityRequiredError(
      'A runtime-minted workspace project state storage is required.',
    );
  }
  return access;
}

/**
 * Counts, and with `apply` removes, the temp files crashed replaces left in a directory of `storage`
 * (`relativeDirectory`, `''` for its root), through the same anchored writer as every other project
 * write; `migrationStartedAt` is when the migration started, by the filesystem's clock. Internal: a
 * store's migration sweeps the directories it visits.
 */
export function sweepWorkspaceProjectStateTemporaries(
  storage: IWorkspaceProjectStateStorage,
  relativeDirectory: string,
  apply: boolean,
  migrationStartedAt?: number,
): number {
  const access = migrationAccessOf(storage);
  return access.boundary.sweepTemporaries(
    access.projectRelativePath(relativeDirectory, true),
    apply,
    migrationStartedAt,
  );
}

/**
 * How many names the regular file at `relativePath` of `storage` has, opened through the anchored
 * writer without following a link; `undefined` when it is missing. Internal: a migration refuses a
 * file with another name, since replacing it would leave the plaintext under that name.
 */
export function workspaceProjectStateLinkCount(
  storage: IWorkspaceProjectStateStorage,
  relativePath: string,
): number | undefined {
  const access = migrationAccessOf(storage);
  return access.boundary.linkCount(access.projectRelativePath(relativePath, false));
}

/**
 * The absolute path of directory `relativeDirectory` of `storage`, for a host mechanism that must
 * address it by path — the writer markers of a project's session store, which hard links publish. No
 * segment from the trusted root down to it may be a link or anything but a directory, since one would
 * put what is kept there outside the project; a segment not made yet ends the check, and the caller
 * makes it. Internal to the framework.
 */
export function workspaceProjectStateDirectoryPath(
  storage: IWorkspaceProjectStateStorage,
  relativeDirectory: string,
): string {
  const access = migrationAccessOf(storage);
  const relative = access.projectRelativePath(relativeDirectory, true);
  let current = access.worktreeRoot;
  for (const segment of relative.split(sep).filter((part) => part.length > 0)) {
    current = join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new WorkspaceAuthorityRequiredError(
        'A project state directory is a link or not a directory, so it may lie outside the project.',
      );
    }
  }
  return join(access.worktreeRoot, relative);
}

/** New content for a file of a storage, flushed beside it until {@link commit} puts it in place. */
export interface IStagedWorkspaceProjectStateFile {
  /** Renames the staged file over the target and flushes the directory. */
  commit(): void;
  /** Removes the staged file if it was not committed. Idempotent. */
  discard(): void;
}

/**
 * `content` flushed to a temp file beside `relativePath` of `storage`, the target left as it is, so a
 * migration can stage every file of a store before it renames any. Internal to the framework.
 */
export function stageWorkspaceProjectStateFile(
  storage: IWorkspaceProjectStateStorage,
  relativePath: string,
  content: Uint8Array,
): IStagedWorkspaceProjectStateFile {
  const access = migrationAccessOf(storage);
  const boundary = access.boundary;
  const target = access.projectRelativePath(relativePath, false);
  const temporaryName = boundary.stage(target, content);
  let settled = false;
  return {
    commit: () => {
      if (settled) throw new Error('A staged project file is committed or discarded only once.');
      settled = true;
      try {
        boundary.commitStaged(target, temporaryName);
      } catch (error) {
        try {
          boundary.discardStaged(target, temporaryName);
        } catch {
          // allow-fallback: a staged file that cannot be removed holds sealed bytes; the sweep finds it.
        }
        throw error;
      }
    },
    discard: () => {
      if (settled) return;
      settled = true;
      boundary.discardStaged(target, temporaryName);
    },
  };
}
