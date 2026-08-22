import { isAbsolute, relative, sep, win32 } from 'node:path';

import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';

import type {
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  TWorkspaceContributionKind,
} from './types.js';
import type { Stats } from 'node:fs';

const MAX_PROJECT_READ_BYTES = Number('4194304');

export class ProjectReadLimitExceededError extends WorkspaceAuthorityRequiredError {
  constructor(
    readonly maxBytes: number,
    readonly actualBytes: bigint,
  ) {
    super(`The requested project file exceeds the read limit of ${maxBytes} bytes.`);
  }
}

export function refuseProjectRead(message: string): never {
  throw new WorkspaceAuthorityRequiredError(message);
}

export function assertProjectReadPurpose(purpose: string): void {
  if (purpose.trim().length === 0) {
    refuseProjectRead('Every project read must declare its purpose.');
  }
}

export function resolveProjectReadLimit(maxBytes?: number): number {
  if (
    maxBytes !== undefined &&
    (!Number.isFinite(maxBytes) || !Number.isSafeInteger(maxBytes) || maxBytes < 0)
  ) {
    refuseProjectRead('Project read maxBytes must be a finite, non-negative safe integer.');
  }
  return Math.min(maxBytes ?? MAX_PROJECT_READ_BYTES, MAX_PROJECT_READ_BYTES);
}

export function workspaceContributionKind(metadata: Stats): TWorkspaceContributionKind {
  if (metadata.isSymbolicLink()) return 'link';
  if (metadata.isFile()) return 'file';
  if (metadata.isDirectory()) return 'directory';
  return 'other';
}

export function isWorkspacePathContained(root: string, candidate: string): boolean {
  const remainder = relative(root, candidate);
  return (
    remainder === '' ||
    (remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder))
  );
}

export function workspacePathSegments(value: string, allowRoot = false): readonly string[] {
  if (
    value.includes('\0') ||
    isAbsolute(value) ||
    win32.isAbsolute(value) ||
    (value.length === 0 && !allowRoot)
  ) {
    refuseProjectRead('Project reads require a root-relative path.');
  }
  if (value.length === 0) return [];
  const segments = value.replaceAll('\\', '/').split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    refuseProjectRead(
      'Project reads cannot contain empty, current-directory, or parent-directory segments.',
    );
  }
  return segments;
}

function isSameWorkspaceIdentity(left: IWorkspaceIdentity, right: IWorkspaceIdentity): boolean {
  return left.repositoryKey === right.repositoryKey && left.worktreeRoot === right.worktreeRoot;
}

export function assertCurrentWorkspaceIdentity(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
): void {
  let current: IWorkspaceIdentity;
  try {
    current = identityResolver.resolve(identity.worktreeRoot);
  } catch {
    refuseProjectRead('The workspace identity could not be revalidated for this project read.');
  }
  if (!isSameWorkspaceIdentity(identity, current)) {
    refuseProjectRead('The workspace identity changed after project access was granted.');
  }
}
