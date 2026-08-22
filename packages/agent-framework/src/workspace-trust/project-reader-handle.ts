import { closeSync, constants, lstatSync, openSync, readdirSync, realpathSync } from 'node:fs';

import { readBoundedProjectFile } from './project-reader-bounded-file.js';
import {
  assertCurrentWorkspaceIdentity,
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

function descriptorPath(descriptor: number, segment?: string): string {
  const root = `/proc/self/fd/${descriptor}`;
  return segment === undefined ? root : `${root}/${segment}`;
}

function openFlags(directory: boolean): number {
  return (
    constants.O_RDONLY |
    (constants.O_NOFOLLOW ?? 0) |
    (constants.O_NONBLOCK ?? 0) |
    (directory ? (constants.O_DIRECTORY ?? 0) : 0)
  );
}

function withVerifiedRoot<T>(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  operation: (rootDescriptor: number) => T,
): T {
  assertCurrentWorkspaceIdentity(identity, identityResolver);
  let rootDescriptor: number | undefined;
  try {
    rootDescriptor = openSync(identity.worktreeRoot, openFlags(true));
    if (realpathSync(descriptorPath(rootDescriptor)) !== identity.worktreeRoot) {
      refuseProjectRead('The opened project root no longer matches the trusted workspace root.');
    }
    assertCurrentWorkspaceIdentity(identity, identityResolver);
    return operation(rootDescriptor);
  } catch (error) {
    if (error instanceof WorkspaceAuthorityRequiredError) throw error;
    throw new WorkspaceAuthorityRequiredError('The project root could not be opened safely.');
  } finally {
    if (rootDescriptor !== undefined) closeSync(rootDescriptor);
  }
}

function openRelative(
  rootDescriptor: number,
  segments: readonly string[],
  expectedKind: 'file' | 'directory',
): number | undefined {
  let parentDescriptor = rootDescriptor;
  let ownsParent = false;
  try {
    for (let index = 0; index < segments.length; index += 1) {
      const final = index === segments.length - 1;
      let descriptor: number;
      try {
        descriptor = openSync(
          descriptorPath(parentDescriptor, segments[index]),
          openFlags(!final || expectedKind === 'directory'),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        refuseProjectRead('Project reads do not follow links or replaced path ancestors.');
      }
      if (ownsParent) closeSync(parentDescriptor);
      parentDescriptor = descriptor;
      ownsParent = true;
    }
    if (!ownsParent) return rootDescriptor;
    const result = parentDescriptor;
    ownsParent = false;
    return result;
  } finally {
    if (ownsParent) closeSync(parentDescriptor);
  }
}

export function readProjectBytesFromHandle(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  segments: readonly string[],
  maxBytes: number,
): Uint8Array | undefined {
  return withVerifiedRoot(identity, identityResolver, (rootDescriptor) => {
    const descriptor = openRelative(rootDescriptor, segments, 'file');
    if (descriptor === undefined) return undefined;
    try {
      return readBoundedProjectFile(descriptor, maxBytes);
    } finally {
      closeSync(descriptor);
    }
  });
}

export function listProjectDirectoryFromHandle(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  segments: readonly string[],
): readonly IWorkspaceDirectoryEntry[] {
  return withVerifiedRoot(identity, identityResolver, (rootDescriptor) => {
    const descriptor = openRelative(rootDescriptor, segments, 'directory');
    if (descriptor === undefined) return [];
    try {
      return readdirSync(descriptorPath(descriptor), { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        kind: entry.isSymbolicLink()
          ? 'link'
          : entry.isFile()
            ? 'file'
            : entry.isDirectory()
              ? 'directory'
              : 'other',
      }));
    } finally {
      if (descriptor !== rootDescriptor) closeSync(descriptor);
    }
  });
}

export function inspectProjectKindFromHandle(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  segments: readonly string[],
): TWorkspaceContributionKind | undefined {
  return withVerifiedRoot(identity, identityResolver, (rootDescriptor) => {
    if (segments.length === 0) return 'directory';
    const parentDescriptor = openRelative(rootDescriptor, segments.slice(0, -1), 'directory');
    if (parentDescriptor === undefined) return undefined;
    try {
      try {
        return workspaceContributionKind(
          lstatSync(descriptorPath(parentDescriptor, segments.at(-1)!)),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    } finally {
      if (parentDescriptor !== rootDescriptor) closeSync(parentDescriptor);
    }
  });
}
