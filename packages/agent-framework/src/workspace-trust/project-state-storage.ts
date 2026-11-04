import { assertProjectReadPurpose, workspacePathSegments } from './project-reader-path.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';
import {
  assertWorkspaceProjectAuthority,
  getWorkspaceProjectIdentity,
  getWorkspaceProjectMutationBoundary,
  getWorkspaceProjectReader,
  getWorkspaceProjectStateDirectories,
} from './workspace-authority.js';

import type {
  IWorkspaceDirectoryEntry,
  IWorkspaceProjectAuthority,
  IWorkspaceProjectMutationBoundary,
  IWorkspaceProjectReader,
  IWorkspaceProjectStateStorage,
  TWorkspaceProjectAuthorityCandidate,
  TWorkspaceProjectStateNamespace,
} from './types.js';

const projectStateStorages = new WeakMap<object, IWorkspaceProjectAuthority>();
const textEncoder = new TextEncoder();
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
  // `#` so no property of the facet carries the authority, the reader or the host's writer.
  readonly #authority: IWorkspaceProjectAuthority;
  readonly #reader: IWorkspaceProjectReader;
  readonly #mutationBoundary: IWorkspaceProjectMutationBoundary;

  constructor(
    namespace: TWorkspaceProjectStateNamespace,
    rootRelativePath: string,
    authority: IWorkspaceProjectAuthority,
    reader: IWorkspaceProjectReader,
    mutationBoundary: IWorkspaceProjectMutationBoundary,
  ) {
    this.namespace = namespace;
    this.rootRelativePath = rootRelativePath;
    this.#authority = authority;
    this.#reader = reader;
    this.#mutationBoundary = mutationBoundary;
  }

  readText(relativePath: string, purpose: string): string | undefined {
    assertWorkspaceProjectAuthority(this.#authority);
    return this.#reader.readText(this.projectRelativePath(relativePath), purpose);
  }

  readBytes(relativePath: string, purpose: string, maxBytes?: number): Uint8Array | undefined {
    assertWorkspaceProjectAuthority(this.#authority);
    return this.#reader.readBytes(this.projectRelativePath(relativePath), purpose, maxBytes);
  }

  writeText(relativePath: string, content: string, purpose: string): void {
    assertWorkspaceProjectAuthority(this.#authority);
    this.writeBytes(relativePath, textEncoder.encode(content), purpose);
  }

  writeBytes(relativePath: string, content: Uint8Array, purpose: string): void {
    assertWorkspaceProjectAuthority(this.#authority);
    assertProjectReadPurpose(purpose);
    this.#mutationBoundary.write(this.projectRelativePath(relativePath), content);
  }

  replaceBytes(relativePath: string, content: Uint8Array, purpose: string): void {
    assertWorkspaceProjectAuthority(this.#authority);
    assertProjectReadPurpose(purpose);
    this.#mutationBoundary.replace(this.projectRelativePath(relativePath), content);
  }

  appendText(relativePath: string, content: string, purpose: string): void {
    assertWorkspaceProjectAuthority(this.#authority);
    assertProjectReadPurpose(purpose);
    this.#mutationBoundary.append(this.projectRelativePath(relativePath), content);
  }

  listDirectory(relativePath: string, purpose: string): readonly IWorkspaceDirectoryEntry[] {
    assertWorkspaceProjectAuthority(this.#authority);
    return this.#reader.listDirectory(this.projectRelativePath(relativePath, true), purpose);
  }

  deleteFile(relativePath: string, purpose: string): boolean {
    assertWorkspaceProjectAuthority(this.#authority);
    assertProjectReadPurpose(purpose);
    return this.#mutationBoundary.delete(this.projectRelativePath(relativePath));
  }

  projectRelativePath(relativePath: string, allowRoot = false): string {
    assertWorkspaceProjectAuthority(this.#authority);
    const segments = workspacePathSegments(relativePath, allowRoot);
    if (segments.length === 0) return this.rootRelativePath;
    // The path is spelled with the separator the host spelled its root with (`.robota\sessions` is a
    // Windows host's), so a host that compares it with a path of its own builds the same string; a
    // read splits it back into segments whichever separator it has.
    const separator = this.rootRelativePath.includes('\\') ? '\\' : '/';
    return `${this.rootRelativePath}${separator}${segments.join(separator)}`;
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
  const mutationBoundary = getWorkspaceProjectMutationBoundary(accepted);
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
 * What a host mechanism that must address directory `relativeDirectory` of `storage` by path needs to
 * build that path: the trusted root as plain text and the directory relative to it. The caller joins
 * them and checks each segment on its own file system; this holds no file access. Internal to the
 * framework and exported from no entry: it returns two strings, never the boundary, the access
 * record or a function that takes a root.
 */
export function workspaceProjectStateDirectoryParts(
  storage: IWorkspaceProjectStateStorage,
  relativeDirectory: string,
): { readonly worktreeRoot: string; readonly relativeDirectory: string } {
  const access = migrationAccessOf(storage);
  return Object.freeze({
    worktreeRoot: access.worktreeRoot,
    relativeDirectory: access.projectRelativePath(relativeDirectory, true),
  });
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
