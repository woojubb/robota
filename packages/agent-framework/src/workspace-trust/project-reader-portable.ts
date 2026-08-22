import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  MAX_PROJECT_READ_BYTES,
  assertCurrentWorkspaceIdentity,
  isWorkspacePathContained,
  refuseProjectRead,
  workspaceContributionKind,
} from './project-reader-path.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';

import type {
  IWorkspaceDirectoryEntry,
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  TWorkspaceContributionKind,
} from './types.js';
import type { BigIntStats, Stats } from 'node:fs';

function resolveNoFollowPath(
  identity: IWorkspaceIdentity,
  segments: readonly string[],
): string | undefined {
  let current = identity.worktreeRoot;
  for (const segment of segments) {
    current = join(current, segment);
    let metadata: Stats;
    try {
      metadata = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      refuseProjectRead('The project path could not be inspected safely.');
    }
    if (metadata.isSymbolicLink()) {
      refuseProjectRead('Project reads do not follow links or reparse points.');
    }
  }
  const canonical = realpathSync(current);
  if (!isWorkspacePathContained(identity.worktreeRoot, canonical)) {
    refuseProjectRead('The project path resolved outside the trusted workspace root.');
  }
  return canonical;
}

function assertOpenedObject(target: string, opened: BigIntStats, directory: boolean): void {
  const current = statSync(target, { bigint: true });
  if (
    opened.dev !== current.dev ||
    opened.ino !== current.ino ||
    (directory ? !opened.isDirectory() : !opened.isFile())
  ) {
    refuseProjectRead('The project object changed while its stable handle was being opened.');
  }
}

function assertStillContained(identity: IWorkspaceIdentity, target: string): void {
  if (!isWorkspacePathContained(identity.worktreeRoot, realpathSync(target))) {
    refuseProjectRead('The opened project object resolved outside the trusted workspace root.');
  }
}

export function readPortableProjectBytes(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  segments: readonly string[],
): Uint8Array | undefined {
  assertCurrentWorkspaceIdentity(identity, identityResolver);
  const target = resolveNoFollowPath(identity, segments);
  if (target === undefined) return undefined;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      target,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    assertStillContained(identity, target);
    assertOpenedObject(target, opened, false);
    if (opened.size > BigInt(MAX_PROJECT_READ_BYTES)) {
      refuseProjectRead('The requested project file exceeds the project read limit.');
    }
    assertCurrentWorkspaceIdentity(identity, identityResolver);
    return new Uint8Array(readFileSync(descriptor));
  } catch (error) {
    if (error instanceof WorkspaceAuthorityRequiredError) throw error;
    throw new WorkspaceAuthorityRequiredError(
      'The project file could not be read from a stable handle.',
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function listPortableProjectDirectory(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  segments: readonly string[],
): readonly IWorkspaceDirectoryEntry[] {
  assertCurrentWorkspaceIdentity(identity, identityResolver);
  const target = resolveNoFollowPath(identity, segments);
  if (target === undefined) return [];
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      target,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_DIRECTORY ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    assertStillContained(identity, target);
    assertOpenedObject(target, opened, true);
    const entries = readdirSync(target, { withFileTypes: true }).map(
      (entry): IWorkspaceDirectoryEntry => ({
        name: entry.name,
        kind: entry.isSymbolicLink()
          ? 'link'
          : entry.isFile()
            ? 'file'
            : entry.isDirectory()
              ? 'directory'
              : 'other',
      }),
    );
    assertOpenedObject(target, opened, true);
    assertCurrentWorkspaceIdentity(identity, identityResolver);
    return entries;
  } catch (error) {
    if (error instanceof WorkspaceAuthorityRequiredError) throw error;
    throw new WorkspaceAuthorityRequiredError(
      'The project directory could not be enumerated from a stable handle.',
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function inspectPortableProjectKind(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  segments: readonly string[],
): TWorkspaceContributionKind | undefined {
  assertCurrentWorkspaceIdentity(identity, identityResolver);
  if (segments.length === 0) return 'directory';
  const parentSegments = segments.slice(0, -1);
  const parent =
    parentSegments.length === 0
      ? identity.worktreeRoot
      : resolveNoFollowPath(identity, parentSegments);
  if (parent === undefined) return undefined;
  try {
    const kind = workspaceContributionKind(lstatSync(join(parent, segments.at(-1)!)));
    assertCurrentWorkspaceIdentity(identity, identityResolver);
    return kind;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
