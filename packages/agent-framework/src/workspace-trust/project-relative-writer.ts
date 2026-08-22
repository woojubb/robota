import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  assertCurrentWorkspaceIdentity,
  refuseProjectRead,
  workspacePathSegments,
} from './project-reader-path.js';

import type { IWorkspaceIdentity, IWorkspaceIdentityResolver } from './types.js';

const OWNER_ONLY_FILE_MODE = 0o600;
const OWNER_ONLY_DIRECTORY_MODE = 0o700;

function ensureDirectoryPath(root: string, segments: readonly string[]): string {
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    if (!existsSync(current)) {
      mkdirSync(current, { mode: OWNER_ONLY_DIRECTORY_MODE });
    }
    const metadata = lstatSync(current);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      refuseProjectRead('Project writes do not follow links or non-directory ancestors.');
    }
  }
  return current;
}

function resolveWritableFile(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  relativePath: string,
): string {
  assertCurrentWorkspaceIdentity(identity, identityResolver);
  const segments = workspacePathSegments(relativePath);
  const filename = segments.at(-1);
  if (filename === undefined) refuseProjectRead('Project writes require a file path.');
  const parent = ensureDirectoryPath(identity.worktreeRoot, segments.slice(0, -1));
  const target = join(parent, filename);
  if (existsSync(target)) {
    const metadata = lstatSync(target);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      refuseProjectRead('Project writes require a regular, non-link file target.');
    }
  }
  assertCurrentWorkspaceIdentity(identity, identityResolver);
  return target;
}

function writeWithFlags(target: string, content: Uint8Array | string, flags: number): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      target,
      flags | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0),
      OWNER_ONLY_FILE_MODE,
    );
    if (!fstatSync(descriptor).isFile()) {
      refuseProjectRead('The opened project write target is not a regular file.');
    }
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
  const target = resolveWritableFile(identity, identityResolver, relativePath);
  writeWithFlags(target, content, constants.O_WRONLY | constants.O_TRUNC);
}

export function appendWorkspaceRelativeFile(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  relativePath: string,
  content: string,
): void {
  const target = resolveWritableFile(identity, identityResolver, relativePath);
  writeWithFlags(target, content, constants.O_WRONLY | constants.O_APPEND);
}

export function deleteWorkspaceRelativeFile(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  relativePath: string,
): boolean {
  const segments = workspacePathSegments(relativePath);
  const filename = segments.at(-1);
  if (filename === undefined) refuseProjectRead('Project deletion requires a file path.');
  assertCurrentWorkspaceIdentity(identity, identityResolver);
  const parent = ensureDirectoryPath(identity.worktreeRoot, segments.slice(0, -1));
  const target = join(parent, filename);
  if (!existsSync(target)) return false;
  const metadata = lstatSync(target);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    refuseProjectRead('Project deletion requires a regular, non-link file target.');
  }
  unlinkSync(target);
  return true;
}
