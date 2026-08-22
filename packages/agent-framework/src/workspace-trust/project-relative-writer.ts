import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

import {
  assertCurrentWorkspaceIdentity,
  refuseProjectRead,
  workspacePathSegments,
} from './project-reader-path.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';

import type { IWorkspaceIdentity, IWorkspaceIdentityResolver } from './types.js';

const OWNER_ONLY_FILE_MODE = 0o600;
const OWNER_ONLY_DIRECTORY_MODE = 0o700;

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

function withAnchoredParent<T>(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  segments: readonly string[],
  operation: (parentDescriptor: number, filename: string) => T,
): T {
  if (process.platform !== 'linux') {
    // Contained — ARCH-047. Portable project mutation fails closed until a stable root-anchored
    // primitive owns equivalent semantics on every supported platform.
    refuseProjectRead('Project mutation requires stable root-anchored host support.');
  }
  assertCurrentWorkspaceIdentity(identity, identityResolver);
  const filename = segments.at(-1);
  if (filename === undefined) refuseProjectRead('Project writes require a file path.');

  let rootDescriptor: number | undefined;
  let parentDescriptor: number | undefined;
  try {
    rootDescriptor = openSync(identity.worktreeRoot, directoryOpenFlags());
    if (realpathSync(descriptorPath(rootDescriptor)) !== identity.worktreeRoot) {
      refuseProjectRead('The opened project root no longer matches the trusted workspace root.');
    }
    assertCurrentWorkspaceIdentity(identity, identityResolver);
    parentDescriptor = rootDescriptor;
    for (const segment of segments.slice(0, -1)) {
      const target = descriptorPath(parentDescriptor, segment);
      let nextDescriptor: number;
      try {
        nextDescriptor = openSync(target, directoryOpenFlags());
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        mkdirSync(target, { mode: OWNER_ONLY_DIRECTORY_MODE });
        nextDescriptor = openSync(target, directoryOpenFlags());
      }
      if (!fstatSync(nextDescriptor).isDirectory()) {
        closeSync(nextDescriptor);
        refuseProjectRead('Project writes require regular, non-link directory ancestors.');
      }
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
  truncate: boolean,
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
    if (truncate) ftruncateSync(descriptor, 0);
    writeFileSync(descriptor, content);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function writeWorkspaceRelativeFile(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  relativePath: string,
  content: Uint8Array | string,
): void {
  const segments = workspacePathSegments(relativePath);
  withAnchoredParent(identity, identityResolver, segments, (parentDescriptor, filename) => {
    writeWithFlags(parentDescriptor, filename, content, constants.O_WRONLY, true);
  });
}

export function appendWorkspaceRelativeFile(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  relativePath: string,
  content: string,
): void {
  const segments = workspacePathSegments(relativePath);
  withAnchoredParent(identity, identityResolver, segments, (parentDescriptor, filename) => {
    writeWithFlags(
      parentDescriptor,
      filename,
      content,
      constants.O_WRONLY | constants.O_APPEND,
      false,
    );
  });
}

export function deleteWorkspaceRelativeFile(
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
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      refuseProjectRead('Project deletion requires a regular, non-link file target.');
    }
    unlinkSync(target);
    return true;
  });
}
