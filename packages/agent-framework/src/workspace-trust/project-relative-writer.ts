import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

import { createProcessMarkersInOpenDirectory } from '@robota-sdk/agent-core/node';
import { createProcessOperationLock } from '@robota-sdk/agent-session/node';

import {
  assertCurrentWorkspaceIdentity,
  refuseProjectRead,
  workspacePathSegments,
} from './project-reader-path.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';

import type { IProcessMarkerHandle, TProcessMarkerGuardResult } from '@robota-sdk/agent-core';
import type {
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceProjectMutationBoundary,
} from './types.js';

const OWNER_ONLY_FILE_MODE = 0o600;
const OWNER_ONLY_DIRECTORY_MODE = 0o700;

/** What a person sees on a platform where project writes cannot be proven to stay under the root. */
const PROJECT_MUTATION_UNSUPPORTED =
  'Project mutation requires stable root-anchored host support: only on Linux can the host prove ' +
  'that a project write stays under the trusted workspace root, so on this platform it refuses ' +
  "every project mutation. Run on Linux, or make the change to the project's files yourself.";

/**
 * Whether a project write on `platform` can be proven to stay under the trusted root. The proof
 * walks descriptor-relative paths through `/proc/self/fd`, which only Linux provides; elsewhere every
 * project mutation is refused, so a host keeps state it must write somewhere other than the project.
 */
export function supportsWorkspaceProjectMutation(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'linux';
}

function descriptorPath(descriptor: number, segment?: string): string {
  const root = `/proc/self/fd/${descriptor}`;
  return segment === undefined ? root : `${root}/${segment}`;
}

function directoryOpenFlags(): number {
  return (
    constants.O_RDONLY |
    (constants.O_NOFOLLOW ?? 0) |
    (constants.O_NONBLOCK ?? 0) |
    (constants.O_DIRECTORY ?? 0)
  );
}

/**
 * The directory `segment` under the anchored `parentDescriptor`, opened without following a link;
 * created owner-only when `create` is set and it is missing, `undefined` when it is missing otherwise.
 */
function openAnchoredDirectory(
  parentDescriptor: number,
  segment: string,
  create: boolean,
): number | undefined {
  const target = descriptorPath(parentDescriptor, segment);
  let descriptor: number;
  try {
    descriptor = openSync(target, directoryOpenFlags());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (!create) return undefined;
    try {
      mkdirSync(target, { mode: OWNER_ONLY_DIRECTORY_MODE });
    } catch (creationError) {
      if ((creationError as NodeJS.ErrnoException).code !== 'EEXIST') throw creationError;
    }
    descriptor = openSync(target, directoryOpenFlags());
  }
  if (!fstatSync(descriptor).isDirectory()) {
    closeSync(descriptor);
    refuseProjectRead('Project writes require regular, non-link directory ancestors.');
  }
  return descriptor;
}

function withAnchoredParent<T>(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  segments: readonly string[],
  operation: (parentDescriptor: number, filename: string) => T,
): T {
  if (!supportsWorkspaceProjectMutation()) {
    // Contained. Portable project mutation fails closed until a stable root-anchored
    // primitive owns equivalent semantics on every supported platform.
    refuseProjectRead(PROJECT_MUTATION_UNSUPPORTED);
  }
  assertCurrentWorkspaceIdentity(identity, identityResolver);
  const filename = segments.at(-1);
  if (filename === undefined) refuseProjectRead('Project writes require a file path.');

  let rootDescriptor: number | undefined;
  let parentDescriptor: number | undefined;
  try {
    rootDescriptor = openSync(identity.worktreeRoot, directoryOpenFlags());
    identityResolver.assertOpenedRootDescriptor?.(rootDescriptor);
    if (realpathSync(descriptorPath(rootDescriptor)) !== identity.worktreeRoot) {
      refuseProjectRead('The opened project root no longer matches the trusted workspace root.');
    }
    assertCurrentWorkspaceIdentity(identity, identityResolver);
    parentDescriptor = rootDescriptor;
    for (const segment of segments.slice(0, -1)) {
      const nextDescriptor = openAnchoredDirectory(parentDescriptor, segment, true);
      if (nextDescriptor === undefined) refuseProjectRead('A project directory vanished.');
      if (parentDescriptor !== rootDescriptor) closeSync(parentDescriptor);
      parentDescriptor = nextDescriptor;
    }
    assertCurrentWorkspaceIdentity(identity, identityResolver);
    return operation(parentDescriptor, filename);
  } catch (error) {
    if (error instanceof WorkspaceAuthorityRequiredError) throw error;
    throw new WorkspaceAuthorityRequiredError(
      'The project mutation target could not be opened safely.',
    );
  } finally {
    if (parentDescriptor !== undefined && parentDescriptor !== rootDescriptor) {
      closeSync(parentDescriptor);
    }
    if (rootDescriptor !== undefined) closeSync(rootDescriptor);
  }
}

function writeWithFlags(
  parentDescriptor: number,
  filename: string,
  content: Uint8Array | string,
  flags: number,
  options: { readonly truncate: boolean; readonly sync?: boolean },
): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      descriptorPath(parentDescriptor, filename),
      flags | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0),
      OWNER_ONLY_FILE_MODE,
    );
    if (!fstatSync(descriptor).isFile()) {
      refuseProjectRead('The opened project write target is not a regular file.');
    }
    if (options.truncate) ftruncateSync(descriptor, 0);
    writeFileSync(descriptor, content);
    if (options.sync === true) fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function writeWorkspaceRelativeFile(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  relativePath: string,
  content: Uint8Array | string,
): void {
  const segments = workspacePathSegments(relativePath);
  withAnchoredParent(identity, identityResolver, segments, (parentDescriptor, filename) => {
    writeWithFlags(parentDescriptor, filename, content, constants.O_WRONLY, { truncate: true });
  });
}

/** Random enough that two writers of one file never pick the same temp name. */
const TEMP_NAME_RANDOM_BYTES = 8;

/** A replace takes milliseconds, so a temp file this much older than its directory's last change is a crash's. */
const STALE_TEMP_AGE_MS = 5 * 60 * 1000;

const REGEXP_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g;

/** `fsync` of a directory is POSIX; a few filesystems refuse the call. */
function syncDirectory(directoryDescriptor: number): void {
  try {
    fsyncSync(directoryDescriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // allow-fallback: EINVAL/ENOTSUP mean the filesystem has no directory flush to offer.
    if (code !== 'EINVAL' && code !== 'ENOTSUP') throw error;
  }
}

/**
 * Removes the temp files a crashed replace left in the anchored directory — of `filename` alone, or
 * of any file when none is named: regular files named exactly like a replace's temp, older than
 * `STALE_TEMP_AGE_MS`. Links and directories are never followed or removed. Best-effort, because
 * the replace or delete that called it has already succeeded. Returns how many there were; with
 * `apply` unset they are only counted.
 *
 * Age is judged by the filesystem's clock, not this process's: right after a rename or unlink the
 * directory's mtime is the filesystem's "now", so clock skew against a network filesystem cannot make
 * a live writer's temp look stale. When a delete removed nothing the directory time is older, which
 * only makes the sweep more conservative. A migration also passes when it started, as its marker's
 * time on the filesystem says, so a temp file in a directory nothing changed in since is found.
 */
function sweepStaleTemporaries(
  parentDescriptor: number,
  filename: string | undefined,
  apply = true,
  migrationStartedAt?: number,
): number {
  const name = filename === undefined ? '.+' : filename.replace(REGEXP_SPECIAL_CHARACTERS, '\\$&');
  const pattern = new RegExp(`^\\.${name}\\.[0-9a-f]{${TEMP_NAME_RANDOM_BYTES * 2}}\\.tmp$`);
  let names: string[];
  let now: number;
  try {
    now = Math.max(
      fstatSync(parentDescriptor).mtimeMs,
      migrationStartedAt ?? Number.NEGATIVE_INFINITY,
    );
    names = readdirSync(descriptorPath(parentDescriptor));
  } catch {
    return 0; // allow-fallback: a sweep that cannot list the directory has nothing to remove.
  }
  let swept = 0;
  for (const entry of names) {
    if (!pattern.test(entry)) continue;
    try {
      const candidate = descriptorPath(parentDescriptor, entry);
      const metadata = lstatSync(candidate);
      if (!metadata.isFile() || now - metadata.mtimeMs <= STALE_TEMP_AGE_MS) continue;
      if (apply) unlinkSync(candidate);
      swept += 1;
    } catch {
      // allow-fallback: a writer renamed it first or it cannot be removed; leftovers are retried next time.
    }
  }
  return swept;
}

function replaceWorkspaceRelativeFile(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  relativePath: string,
  content: Uint8Array | string,
): void {
  const segments = workspacePathSegments(relativePath);
  withAnchoredParent(identity, identityResolver, segments, (parentDescriptor, filename) => {
    const temporary = writeTemporary(parentDescriptor, filename, content);
    try {
      // Both names resolve through the one anchored directory, so the rename cannot leave it. A
      // link at the target is replaced as an entry, never followed.
      renameSync(
        descriptorPath(parentDescriptor, temporary),
        descriptorPath(parentDescriptor, filename),
      );
    } catch (error) {
      removeTemporary(parentDescriptor, temporary);
      throw error;
    }
    syncDirectory(parentDescriptor);
    sweepStaleTemporaries(parentDescriptor, filename);
  });
}

function removeTemporary(parentDescriptor: number, temporary: string): void {
  try {
    unlinkSync(descriptorPath(parentDescriptor, temporary));
  } catch {
    // allow-fallback: the temp file may never have been created; the original error is the one to report.
  }
}

/** Writes `content` to a fresh temp file beside `filename` and flushes it; returns its name. */
function writeTemporary(
  parentDescriptor: number,
  filename: string,
  content: Uint8Array | string,
): string {
  // Hidden and not ending in the target's extension, so a listing that looks for records never
  // takes a temp file left by a crash for one. `O_EXCL` makes this call the file's creator.
  const temporary = `.${filename}.${randomBytes(TEMP_NAME_RANDOM_BYTES).toString('hex')}.tmp`;
  try {
    // The content is on disk before the rename publishes it, so a power cut never leaves the
    // target pointing at a file whose data was not written.
    writeWithFlags(parentDescriptor, temporary, content, constants.O_WRONLY | constants.O_EXCL, {
      truncate: false,
      sync: true,
    });
  } catch (error) {
    removeTemporary(parentDescriptor, temporary);
    throw error;
  }
  return temporary;
}

/** A name a staged temp file of `filename` can have, and nothing else: it never leaves the directory. */
function assertStagedName(filename: string, temporaryName: string): void {
  const escaped = filename.replace(REGEXP_SPECIAL_CHARACTERS, '\\$&');
  const pattern = new RegExp(`^\\.${escaped}\\.[0-9a-f]{${TEMP_NAME_RANDOM_BYTES * 2}}\\.tmp$`);
  if (!pattern.test(temporaryName)) refuseProjectRead('That is not a staged project file.');
}

function stageWorkspaceRelativeFile(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  relativePath: string,
  content: Uint8Array | string,
): string {
  const segments = workspacePathSegments(relativePath);
  return withAnchoredParent(identity, identityResolver, segments, (parentDescriptor, filename) =>
    writeTemporary(parentDescriptor, filename, content),
  );
}

function commitStagedWorkspaceRelativeFile(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  relativePath: string,
  temporaryName: string,
): void {
  const segments = workspacePathSegments(relativePath);
  withAnchoredParent(identity, identityResolver, segments, (parentDescriptor, filename) => {
    assertStagedName(filename, temporaryName);
    if (!lstatSync(descriptorPath(parentDescriptor, temporaryName)).isFile()) {
      refuseProjectRead('A staged project file is not a regular file.');
    }
    try {
      renameSync(
        descriptorPath(parentDescriptor, temporaryName),
        descriptorPath(parentDescriptor, filename),
      );
    } catch (error) {
      removeTemporary(parentDescriptor, temporaryName);
      throw error;
    }
    syncDirectory(parentDescriptor);
    sweepStaleTemporaries(parentDescriptor, filename);
  });
}

function discardStagedWorkspaceRelativeFile(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  relativePath: string,
  temporaryName: string,
): void {
  const segments = workspacePathSegments(relativePath);
  withExistingAnchoredDirectory(identity, identityResolver, segments.slice(0, -1), (directory) => {
    assertStagedName(segments.at(-1) as string, temporaryName);
    removeTemporary(directory, temporaryName);
  });
}

function workspaceRelativeLinkCount(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  relativePath: string,
): number | undefined {
  const segments = workspacePathSegments(relativePath);
  const filename = segments.at(-1);
  if (filename === undefined) refuseProjectRead('Project reads require a file path.');
  return withExistingAnchoredDirectory(
    identity,
    identityResolver,
    segments.slice(0, -1),
    (directory) => {
      let descriptor: number;
      try {
        descriptor = openSync(
          descriptorPath(directory, filename),
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        refuseProjectRead('Project reads do not follow links.');
      }
      try {
        const metadata = fstatSync(descriptor);
        if (!metadata.isFile()) refuseProjectRead('The project file is not a regular file.');
        return metadata.nlink;
      } finally {
        closeSync(descriptor);
      }
    },
  );
}

export function createWorkspaceProjectMutationBoundary(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
): IWorkspaceProjectMutationBoundary {
  return Object.freeze({
    acquireWriter: (relativeDirectory: string): IProcessMarkerHandle | undefined =>
      acquireWorkspaceRelativeWriter(identity, identityResolver, relativeDirectory),
    claimDirectory: (relativePath: string): boolean =>
      claimWorkspaceRelativeDirectory(identity, identityResolver, relativePath),
    write: (relativePath: string, content: Uint8Array | string): void =>
      writeWorkspaceRelativeFile(identity, identityResolver, relativePath, content),
    replace: (relativePath: string, content: Uint8Array | string): void =>
      replaceWorkspaceRelativeFile(identity, identityResolver, relativePath, content),
    append: (relativePath: string, content: string): void =>
      appendWorkspaceRelativeFile(identity, identityResolver, relativePath, content),
    delete: (relativePath: string): boolean =>
      deleteWorkspaceRelativeFile(identity, identityResolver, relativePath),
    sweepTemporaries: (
      relativeDirectory: string,
      apply: boolean,
      migrationStartedAt?: number,
    ): number =>
      sweepWorkspaceRelativeTemporaries(
        identity,
        identityResolver,
        relativeDirectory,
        apply,
        migrationStartedAt,
      ),
    linkCount: (relativePath: string): number | undefined =>
      workspaceRelativeLinkCount(identity, identityResolver, relativePath),
    stage: (relativePath: string, content: Uint8Array | string): string =>
      stageWorkspaceRelativeFile(identity, identityResolver, relativePath, content),
    commitStaged: (relativePath: string, temporaryName: string): void =>
      commitStagedWorkspaceRelativeFile(identity, identityResolver, relativePath, temporaryName),
    discardStaged: (relativePath: string, temporaryName: string): void =>
      discardStagedWorkspaceRelativeFile(identity, identityResolver, relativePath, temporaryName),
  });
}

/** Retain the checked directory descriptor for every marker operation and its whole lease. */
function acquireWorkspaceRelativeWriter(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  relativeDirectory: string,
): IProcessMarkerHandle | undefined {
  const segments = workspacePathSegments(relativeDirectory);
  let descriptor: number | undefined;
  let acquired: IProcessMarkerHandle | undefined;
  try {
    descriptor = withAnchoredParent(identity, identityResolver, segments, (parent, name) => {
      const opened = openAnchoredDirectory(parent, name, true);
      if (opened === undefined) refuseProjectRead('The checkpoint writer directory vanished.');
      return opened;
    });
    const retained = descriptor;
    const original = fstatSync(retained, { bigint: true });
    const stillNamed = (): boolean =>
      withExistingAnchoredDirectory(identity, identityResolver, segments, (current) => {
        const observed = fstatSync(current, { bigint: true });
        return observed.dev === original.dev && observed.ino === original.ino;
      }) ?? false;
    if (!stillNamed())
      refuseProjectRead('The checkpoint writer directory is no longer named by the project.');
    const result = createProcessMarkersInOpenDirectory(retained, {
      operationLock: createProcessOperationLock(descriptorPath(retained)),
    }).acquire('active');
    if (result.status !== 'acquired') return undefined;
    acquired = result.handle;
    if (!stillNamed())
      refuseProjectRead('The checkpoint writer directory is no longer named by the project.');
    const marker = acquired;
    let released = false;
    const namedNow = (): boolean => {
      try {
        return stillNamed();
      } catch {
        return false;
      }
    };
    const lease: IProcessMarkerHandle = {
      holds: () => {
        if (released) return false;
        try {
          return stillNamed() && marker.holds();
        } catch {
          return false;
        }
      },
      withGuard: <T>(operation: () => T): TProcessMarkerGuardResult<T> => {
        if (released) return { status: 'lost' };
        const guarded = marker.withGuard(() =>
          namedNow() ? { named: true as const, value: operation() } : { named: false as const },
        );
        if (guarded.status !== 'ran') return guarded;
        return guarded.value.named
          ? { status: 'ran', value: guarded.value.value }
          : { status: 'lost' };
      },
      release: () => {
        if (released) return;
        released = true;
        try {
          marker.release();
        } finally {
          closeSync(retained);
        }
      },
    };
    acquired = undefined;
    descriptor = undefined;
    return lease;
  } finally {
    acquired?.release();
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function claimWorkspaceRelativeDirectory(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  relativePath: string,
): boolean {
  return withAnchoredParent(
    identity,
    identityResolver,
    workspacePathSegments(relativePath),
    (parent, name) => {
      const target = descriptorPath(parent, name);
      try {
        mkdirSync(target, { mode: OWNER_ONLY_DIRECTORY_MODE });
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const metadata = lstatSync(target, { throwIfNoEntry: false });
        if (metadata !== undefined && !metadata.isDirectory()) {
          refuseProjectRead('A checkpoint directory claim collided with a non-directory.');
        }
        return false;
      }
    },
  );
}

function appendWorkspaceRelativeFile(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  relativePath: string,
  content: string,
): void {
  const segments = workspacePathSegments(relativePath);
  withAnchoredParent(identity, identityResolver, segments, (parentDescriptor, filename) => {
    writeWithFlags(parentDescriptor, filename, content, constants.O_WRONLY | constants.O_APPEND, {
      truncate: false,
    });
  });
}

function deleteWorkspaceRelativeFile(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  relativePath: string,
): boolean {
  const segments = workspacePathSegments(relativePath);
  return withAnchoredParent(identity, identityResolver, segments, (parentDescriptor, filename) => {
    const target = descriptorPath(parentDescriptor, filename);
    let metadata;
    try {
      metadata = lstatSync(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // Nothing to remove, yet a crashed replace can still have left a temp file for this name.
      sweepStaleTemporaries(parentDescriptor, filename);
      return false;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      refuseProjectRead('Project deletion requires a regular, non-link file target.');
    }
    unlinkSync(target);
    sweepStaleTemporaries(parentDescriptor, filename);
    return true;
  });
}

/**
 * Runs `operation` on the anchored directory `segments` names under the trusted root, opened without
 * following a link and without creating anything; `undefined` when a directory on the way is missing.
 */
function withExistingAnchoredDirectory<T>(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  segments: readonly string[],
  operation: (directoryDescriptor: number) => T,
): T | undefined {
  if (!supportsWorkspaceProjectMutation()) {
    refuseProjectRead(PROJECT_MUTATION_UNSUPPORTED);
  }
  assertCurrentWorkspaceIdentity(identity, identityResolver);
  const opened: number[] = [];
  try {
    const rootDescriptor = openSync(identity.worktreeRoot, directoryOpenFlags());
    opened.push(rootDescriptor);
    identityResolver.assertOpenedRootDescriptor?.(rootDescriptor);
    if (realpathSync(descriptorPath(rootDescriptor)) !== identity.worktreeRoot) {
      refuseProjectRead('The opened project root no longer matches the trusted workspace root.');
    }
    let directory = rootDescriptor;
    for (const segment of segments) {
      const next = openAnchoredDirectory(directory, segment, false);
      if (next === undefined) return undefined;
      opened.push(next);
      directory = next;
    }
    assertCurrentWorkspaceIdentity(identity, identityResolver);
    return operation(directory);
  } catch (error) {
    if (error instanceof WorkspaceAuthorityRequiredError) throw error;
    throw new WorkspaceAuthorityRequiredError('The project directory could not be opened safely.');
  } finally {
    for (const descriptor of opened.reverse()) closeSync(descriptor);
  }
}

function sweepWorkspaceRelativeTemporaries(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  relativeDirectory: string,
  apply: boolean,
  migrationStartedAt: number | undefined,
): number {
  const segments = workspacePathSegments(relativeDirectory, true);
  return (
    withExistingAnchoredDirectory(identity, identityResolver, segments, (directory) =>
      sweepStaleTemporaries(directory, undefined, apply, migrationStartedAt),
    ) ?? 0
  );
}
