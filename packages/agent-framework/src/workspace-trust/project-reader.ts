import { separatorOf, utf8Decode } from '@robota-sdk/agent-core';

import {
  assertCurrentWorkspaceIdentity,
  assertProjectReadPurpose,
  ProjectReadLimitExceededError,
  refuseProjectRead,
  resolveProjectReadLimit,
  workspacePathSegments,
} from './project-reader-path.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';

import type {
  IWorkspaceAncestorTextEntry,
  IWorkspaceDirectoryEntry,
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceProjectFiles,
  IWorkspaceProjectReader,
  TWorkspaceProjectAuthorityCandidate,
  TWorkspaceContributionKind,
} from './types.js';

const projectReaders = new WeakMap<object, () => void>();
const FIRST_BYTE_OVER_LIMIT = BigInt('1');

function readProjectBytes(
  projectFiles: IWorkspaceProjectFiles,
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  segments: readonly string[],
  maxBytes: number,
): Uint8Array | undefined {
  assertCurrentWorkspaceIdentity(identity, identityResolver);
  try {
    const bytes = projectFiles.readBytes(identity.worktreeRoot, segments, maxBytes);
    if (bytes === 'over-budget') return throwProjectReadLimitExceeded(maxBytes);
    return bytes;
  } catch (error) {
    // A refusal the host already phrased (or the limit above) passes through whole; anything else a
    // host throws is reported as a refusal that names no path.
    if (error instanceof WorkspaceAuthorityRequiredError) throw error;
    throw new WorkspaceAuthorityRequiredError(
      'The project file could not be read through a stable root authority.',
    );
  } finally {
    assertCurrentWorkspaceIdentity(identity, identityResolver);
  }
}

function throwProjectReadLimitExceeded(maxBytes: number): never {
  throw new ProjectReadLimitExceededError(maxBytes, BigInt(maxBytes) + FIRST_BYTE_OVER_LIMIT);
}

class WorkspaceProjectReader {
  constructor(
    private readonly projectFiles: IWorkspaceProjectFiles,
    private readonly identity: IWorkspaceIdentity,
    private readonly identityResolver: IWorkspaceIdentityResolver,
    private readonly assertActive: () => void,
  ) {}

  readText(relativePath: string, purpose: string): string | undefined {
    this.assertActive();
    const bytes = this.readBytes(relativePath, purpose);
    return bytes === undefined ? undefined : utf8Decode(bytes);
  }

  readBytes(relativePath: string, purpose: string, maxBytes?: number): Uint8Array | undefined {
    this.assertActive();
    assertProjectReadPurpose(purpose);
    const segments = workspacePathSegments(relativePath);
    const limit = resolveProjectReadLimit(maxBytes);
    try {
      return readProjectBytes(
        this.projectFiles,
        this.identity,
        this.identityResolver,
        segments,
        limit,
      );
    } finally {
      this.assertActive();
    }
  }

  listDirectory(relativePath: string, purpose: string): readonly IWorkspaceDirectoryEntry[] {
    this.assertActive();
    assertProjectReadPurpose(purpose);
    const segments = workspacePathSegments(relativePath, true);
    return this.projectFiles.listDirectory(this.identity, this.identityResolver, segments);
  }

  inspectKind(relativePath: string, purpose: string): TWorkspaceContributionKind | undefined {
    this.assertActive();
    assertProjectReadPurpose(purpose);
    const segments = workspacePathSegments(relativePath, true);
    return this.projectFiles.inspectKind(this.identity, this.identityResolver, segments);
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
      // Spelled with the separator of the root's own platform (`\` under `C:\repo`), as `node:path`
      // spelled it; a read splits it back into segments whichever separator it has.
      const relativePath = [...directory, filenameSegments[0]].join(
        separatorOf(this.identity.worktreeRoot),
      );
      const content = this.readText(relativePath, purpose);
      if (content !== undefined) entries.push({ relativePath, content });
    }
    return entries;
  }
}

/**
 * A reader over `projectFiles` for one identity. Internal: the workspace trust service binds it to an
 * authority it mints, and a host's own contribution root builds one for a root it owns; no barrel
 * exports it, so nothing outside the package can build a reader for an authority.
 */
export function createWorkspaceProjectReader(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  assertActive: () => void,
  projectFiles: IWorkspaceProjectFiles,
): IWorkspaceProjectReader {
  const reader = Object.freeze(
    new WorkspaceProjectReader(projectFiles, identity, identityResolver, assertActive),
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
