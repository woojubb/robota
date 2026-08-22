import { sep } from 'node:path';

import {
  inspectProjectKindFromHandle,
  listProjectDirectoryFromHandle,
  readProjectBytesFromHandle,
} from './project-reader-handle.js';
import {
  assertProjectReadPurpose,
  refuseProjectRead,
  workspacePathSegments,
} from './project-reader-path.js';
import {
  inspectPortableProjectKind,
  listPortableProjectDirectory,
  readPortableProjectBytes,
} from './project-reader-portable.js';

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

  readBytes(relativePath: string, purpose: string): Uint8Array | undefined {
    this.assertActive();
    assertProjectReadPurpose(purpose);
    const segments = workspacePathSegments(relativePath);
    return process.platform === 'linux'
      ? readProjectBytesFromHandle(this.identity, this.identityResolver, segments)
      : readPortableProjectBytes(this.identity, this.identityResolver, segments);
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
