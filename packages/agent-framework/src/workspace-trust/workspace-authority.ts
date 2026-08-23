import { createWorkspaceProjectReader } from './project-reader.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';

import type {
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceProjectAuthority,
  IWorkspaceProjectReader,
  TWorkspaceProjectAuthorityCandidate,
} from './types.js';

interface IWorkspaceAuthorityRecord {
  readonly identity: IWorkspaceIdentity;
  readonly identityResolver: IWorkspaceIdentityResolver;
  readonly reader: IWorkspaceProjectReader;
  readonly isLive: () => boolean;
}

const authorityRecords = new WeakMap<object, IWorkspaceAuthorityRecord>();

/** Internal production issuer. Deliberately absent from every package export barrel. */
export function mintWorkspaceProjectAuthority(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
  isLive: () => boolean,
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
    reader: createWorkspaceProjectReader(identitySnapshot, identityResolver, () => {
      assertWorkspaceProjectAuthority(authority);
    }),
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
