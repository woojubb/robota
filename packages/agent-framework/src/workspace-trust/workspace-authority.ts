import { createWorkspaceProjectReader } from './project-reader.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';

import type {
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceProjectAuthority,
  IWorkspaceProjectFiles,
  IWorkspaceProjectMutationBoundary,
  IWorkspaceProjectReader,
  IWorkspaceProjectStableWriter,
  TWorkspaceProjectStateDirectories,
  TWorkspaceProjectAuthorityCandidate,
} from './types.js';

interface IWorkspaceAuthorityRecord {
  readonly identity: IWorkspaceIdentity;
  readonly identityResolver: IWorkspaceIdentityResolver;
  readonly reader: IWorkspaceProjectReader;
  /** The host's file operations, bound here and nowhere else: every mutation of this authority uses them. */
  readonly projectFiles: IWorkspaceProjectFiles;
  readonly projectStateDirectories?: TWorkspaceProjectStateDirectories;
  readonly isLive: () => boolean;
}

const authorityRecords = new WeakMap<object, IWorkspaceAuthorityRecord>();

/** Internal production issuer. Deliberately absent from every package export barrel. */
export function mintWorkspaceProjectAuthority(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  isLive: () => boolean,
  projectFiles: IWorkspaceProjectFiles,
  projectStateDirectories?: TWorkspaceProjectStateDirectories,
): IWorkspaceProjectAuthority {
  const identitySnapshot = Object.freeze({
    repositoryKey: identity.repositoryKey,
    displayPath: identity.displayPath,
    worktreeRoot: identity.worktreeRoot,
  });
  const authority = Object.freeze(Object.create(null)) as IWorkspaceProjectAuthority;
  authorityRecords.set(authority, {
    identity: identitySnapshot,
    identityResolver,
    reader: createWorkspaceProjectReader(
      identitySnapshot,
      identityResolver,
      () => {
        assertWorkspaceProjectAuthority(authority);
      },
      projectFiles,
    ),
    projectFiles,
    ...(projectStateDirectories === undefined ? {} : { projectStateDirectories }),
    isLive,
  });
  return authority;
}

export function assertWorkspaceProjectAuthority(
  candidate: TWorkspaceProjectAuthorityCandidate,
): IWorkspaceProjectAuthority {
  if (
    (typeof candidate !== 'object' && typeof candidate !== 'function') ||
    candidate === null ||
    !authorityRecords.has(candidate)
  ) {
    throw new WorkspaceAuthorityRequiredError();
  }
  const record = authorityRecords.get(candidate);
  if (record === undefined || !record.isLive()) {
    throw new WorkspaceAuthorityRequiredError(
      'The workspace project authority is no longer active.',
    );
  }
  return candidate as IWorkspaceProjectAuthority;
}

export function getWorkspaceProjectReader(
  authority: IWorkspaceProjectAuthority,
): IWorkspaceProjectReader {
  const accepted = assertWorkspaceProjectAuthority(authority);
  const record = authorityRecords.get(accepted);
  if (record === undefined) throw new WorkspaceAuthorityRequiredError();
  return record.reader;
}

export function getWorkspaceProjectIdentity(
  authority: IWorkspaceProjectAuthority,
): IWorkspaceIdentity {
  const accepted = assertWorkspaceProjectAuthority(authority);
  const record = authorityRecords.get(accepted);
  if (record === undefined) throw new WorkspaceAuthorityRequiredError();
  return record.identity;
}

/** Internal-only dependency for authority-derived imperative adapters. */
export function getWorkspaceProjectIdentityResolver(
  authority: IWorkspaceProjectAuthority,
): IWorkspaceIdentityResolver {
  const accepted = assertWorkspaceProjectAuthority(authority);
  const record = authorityRecords.get(accepted);
  if (record === undefined) throw new WorkspaceAuthorityRequiredError();
  return record.identityResolver;
}

/**
 * Internal: the anchored writer of an authority's root, built by the file operations the trust
 * service bound when it minted the authority. A mutation, a settings writer and a state storage take
 * their boundary here, so none can be given another host's.
 */
export function getWorkspaceProjectMutationBoundary(
  authority: IWorkspaceProjectAuthority,
): IWorkspaceProjectMutationBoundary {
  const accepted = assertWorkspaceProjectAuthority(authority);
  const record = authorityRecords.get(accepted);
  if (record === undefined) throw new WorkspaceAuthorityRequiredError();
  return record.projectFiles.createMutationBoundary(record.identity, record.identityResolver);
}

/** Internal: a writer retaining an authority's root for one approved workflow write. */
export function openWorkspaceProjectStableWriter(
  authority: IWorkspaceProjectAuthority,
): IWorkspaceProjectStableWriter {
  const accepted = assertWorkspaceProjectAuthority(authority);
  const record = authorityRecords.get(accepted);
  if (record === undefined) throw new WorkspaceAuthorityRequiredError();
  return record.projectFiles.createStableWriter(record.identity.worktreeRoot);
}

/** Internal authority-bound host selection; no framework product path is substituted. */
export function getWorkspaceProjectStateDirectories(
  authority: IWorkspaceProjectAuthority,
): TWorkspaceProjectStateDirectories {
  const accepted = assertWorkspaceProjectAuthority(authority);
  const directories = authorityRecords.get(accepted)?.projectStateDirectories;
  if (directories === undefined) {
    throw new WorkspaceAuthorityRequiredError('Host-selected project state directories are required.');
  }
  return directories;
}
