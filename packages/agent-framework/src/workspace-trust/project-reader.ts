import { sep } from 'node:path';

import {
  createStableRootedFileReader,
  StableFileAuthorityError,
} from '@robota-sdk/agent-file-authority';

import {
  inspectProjectKindFromHandle,
  listProjectDirectoryFromHandle,
} from './project-reader-handle.js';
import {
  assertCurrentWorkspaceIdentity,
  assertProjectReadPurpose,
  ProjectReadLimitExceededError,
  refuseProjectRead,
  resolveProjectReadLimit,
  workspacePathSegments,
} from './project-reader-path.js';
import {
  inspectPortableProjectKind,
  listPortableProjectDirectory,
} from './project-reader-portable.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';

import type {
  IWorkspaceAncestorTextEntry,
  IWorkspaceDirectoryEntry,
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceProjectReader,
  TWorkspaceProjectAuthorityCandidate,
  TWorkspaceContributionKind,
} from './types.js';

const projectReaders = new WeakMap<object, () => void>();

function readProjectBytes(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  segments: readonly string[],
  maxBytes: number,
): Uint8Array | undefined {
  assertCurrentWorkspaceIdentity(identity, identityResolver);
  try {
    const reader = createStableRootedFileReader(identity.worktreeRoot);
    try {
      return reader.readBytes(segments, maxBytes);
    } finally {
      reader.close();
    }
  } catch (error) {
    if (error instanceof StableFileAuthorityError) {
      if (error.code === 'OVER_BUDGET') {
        return throwProjectReadLimitExceeded(maxBytes);
      }
      const message = stableProjectReadRefusalMessage(error);
      throw new WorkspaceAuthorityRequiredError(message, error);
    }
    if (error instanceof WorkspaceAuthorityRequiredError) throw error;
    throw new WorkspaceAuthorityRequiredError(
      'The project file could not be read through a stable root authority.',
    );
  } finally {
    assertCurrentWorkspaceIdentity(identity, identityResolver);
  }
}

function stableProjectReadRefusalMessage(error: StableFileAuthorityError): string {
  if (error.code === 'UNSAFE_ENTRY') {
    return 'Project reads do not follow links or replaced path ancestors.';
  }
  if (error.code === 'UNSUPPORTED_BACKEND') {
    return 'This host cannot provide stable root-relative project reads.';
  }
  return 'The project file could not be read through a stable root authority.';
}

function throwProjectReadLimitExceeded(maxBytes: number): never {
  throw new ProjectReadLimitExceededError(maxBytes, BigInt(maxBytes) + 1n);
}

class NodeWorkspaceProjectReader {
  constructor(
    private readonly identity: IWorkspaceIdentity,
    private readonly identityResolver: IWorkspaceIdentityResolver,
    private readonly assertActive: () => void,
  ) {}

  readText(relativePath: string, purpose: string): string | undefined {
    this.assertActive();
    const bytes = this.readBytes(relativePath, purpose);
    return bytes === undefined ? undefined : Buffer.from(bytes).toString('utf8');
  }

  readBytes(relativePath: string, purpose: string, maxBytes?: number): Uint8Array | undefined {
    this.assertActive();
    assertProjectReadPurpose(purpose);
    const segments = workspacePathSegments(relativePath);
    const limit = resolveProjectReadLimit(maxBytes);
    try {
      return readProjectBytes(this.identity, this.identityResolver, segments, limit);
    } finally {
      this.assertActive();
    }
  }

  listDirectory(relativePath: string, purpose: string): readonly IWorkspaceDirectoryEntry[] {
    this.assertActive();
    assertProjectReadPurpose(purpose);
    const segments = workspacePathSegments(relativePath, true);
    return process.platform === 'linux'
      ? listProjectDirectoryFromHandle(this.identity, this.identityResolver, segments)
      : listPortableProjectDirectory(this.identity, this.identityResolver, segments);
  }

  inspectKind(relativePath: string, purpose: string): TWorkspaceContributionKind | undefined {
    this.assertActive();
    assertProjectReadPurpose(purpose);
    const segments = workspacePathSegments(relativePath, true);
    return process.platform === 'linux'
      ? inspectProjectKindFromHandle(this.identity, this.identityResolver, segments)
      : inspectPortableProjectKind(this.identity, this.identityResolver, segments);
  }

  readTextAlongAncestors(
    startRelativeDirectory: string,
    filename: string,
    purpose: string,
  ): readonly IWorkspaceAncestorTextEntry[] {
    this.assertActive();
    assertProjectReadPurpose(purpose);
    const startSegments = workspacePathSegments(startRelativeDirectory, true);
    const filenameSegments = workspacePathSegments(filename);
    if (filenameSegments.length !== 1) {
      refuseProjectRead('Ancestor reads require a single file name.');
    }
    const entries: IWorkspaceAncestorTextEntry[] = [];
    for (let count = 0; count <= startSegments.length; count += 1) {
      const directory = startSegments.slice(0, count);
      const relativePath = [...directory, filenameSegments[0]].join(sep);
      const content = this.readText(relativePath, purpose);
      if (content !== undefined) entries.push({ relativePath, content });
    }
    return entries;
  }
}

export function createWorkspaceProjectReader(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  assertActive: () => void,
): IWorkspaceProjectReader {
  const reader = Object.freeze(
    new NodeWorkspaceProjectReader(identity, identityResolver, assertActive),
  );
  projectReaders.set(reader, assertActive);
  return reader as IWorkspaceProjectReader;
}

export function assertWorkspaceProjectReader(
  candidate: TWorkspaceProjectAuthorityCandidate,
): IWorkspaceProjectReader {
  if (
    (typeof candidate !== 'object' && typeof candidate !== 'function') ||
    candidate === null ||
    !projectReaders.has(candidate)
  ) {
    refuseProjectRead('A runtime-minted workspace project reader is required.');
  }
  projectReaders.get(candidate)?.();
  return candidate as IWorkspaceProjectReader;
}
