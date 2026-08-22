import { join, sep } from 'node:path';

import { assertProjectReadPurpose, workspacePathSegments } from './project-reader-path.js';
import {
  appendWorkspaceRelativeFile,
  deleteWorkspaceRelativeFile,
  writeWorkspaceRelativeFile,
} from './project-relative-writer.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';
import {
  assertWorkspaceProjectAuthority,
  getWorkspaceProjectIdentity,
  getWorkspaceProjectIdentityResolver,
  getWorkspaceProjectReader,
} from './workspace-authority.js';

import type {
  IWorkspaceDirectoryEntry,
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceProjectAuthority,
  IWorkspaceProjectReader,
  IWorkspaceProjectStateStorage,
  TWorkspaceProjectAuthorityCandidate,
  TWorkspaceProjectStateNamespace,
} from './types.js';

const projectStateStorages = new WeakMap<object, IWorkspaceProjectAuthority>();

const NAMESPACE_DIRECTORIES: Readonly<Record<TWorkspaceProjectStateNamespace, string>> = {
  sessions: join('.robota', 'sessions'),
  'session-logs': join('.robota', 'logs'),
  memory: join('.robota', 'memory'),
  checkpoints: join('.robota', 'checkpoints'),
};

class WorkspaceProjectStateStorage {
  readonly namespace: TWorkspaceProjectStateNamespace;
  private readonly base: string;

  constructor(
    namespace: TWorkspaceProjectStateNamespace,
    private readonly authority: IWorkspaceProjectAuthority,
    private readonly identity: IWorkspaceIdentity,
    private readonly identityResolver: IWorkspaceIdentityResolver,
    private readonly reader: IWorkspaceProjectReader,
  ) {
    this.namespace = namespace;
    this.base = NAMESPACE_DIRECTORIES[namespace];
  }

  readText(relativePath: string, purpose: string): string | undefined {
    assertWorkspaceProjectAuthority(this.authority);
    return this.reader.readText(this.projectRelativePath(relativePath), purpose);
  }

  readBytes(relativePath: string, purpose: string, maxBytes?: number): Uint8Array | undefined {
    assertWorkspaceProjectAuthority(this.authority);
    return this.reader.readBytes(this.projectRelativePath(relativePath), purpose, maxBytes);
  }

  writeText(relativePath: string, content: string, purpose: string): void {
    assertWorkspaceProjectAuthority(this.authority);
    this.writeBytes(relativePath, Buffer.from(content), purpose);
  }

  writeBytes(relativePath: string, content: Uint8Array, purpose: string): void {
    assertWorkspaceProjectAuthority(this.authority);
    assertProjectReadPurpose(purpose);
    writeWorkspaceRelativeFile(
      this.identity,
      this.identityResolver,
      this.projectRelativePath(relativePath),
      content,
    );
  }

  appendText(relativePath: string, content: string, purpose: string): void {
    assertWorkspaceProjectAuthority(this.authority);
    assertProjectReadPurpose(purpose);
    appendWorkspaceRelativeFile(
      this.identity,
      this.identityResolver,
      this.projectRelativePath(relativePath),
      content,
    );
  }

  listDirectory(relativePath: string, purpose: string): readonly IWorkspaceDirectoryEntry[] {
    assertWorkspaceProjectAuthority(this.authority);
    return this.reader.listDirectory(this.projectRelativePath(relativePath, true), purpose);
  }

  deleteFile(relativePath: string, purpose: string): boolean {
    assertWorkspaceProjectAuthority(this.authority);
    assertProjectReadPurpose(purpose);
    return deleteWorkspaceRelativeFile(
      this.identity,
      this.identityResolver,
      this.projectRelativePath(relativePath),
    );
  }

  projectRelativePath(relativePath: string, allowRoot = false): string {
    assertWorkspaceProjectAuthority(this.authority);
    const segments = workspacePathSegments(relativePath, allowRoot);
    return segments.length === 0 ? this.base : join(this.base, segments.join(sep));
  }
}

export function getWorkspaceProjectStateStorage(
  authority: IWorkspaceProjectAuthority,
  namespace: TWorkspaceProjectStateNamespace,
): IWorkspaceProjectStateStorage {
  const accepted = assertWorkspaceProjectAuthority(authority);
  const identity = getWorkspaceProjectIdentity(accepted);
  const reader = getWorkspaceProjectReader(accepted);
  const storage = Object.freeze(
    new WorkspaceProjectStateStorage(
      namespace,
      accepted,
      identity,
      getWorkspaceProjectIdentityResolver(accepted),
      reader,
    ),
  );
  projectStateStorages.set(storage, accepted);
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
