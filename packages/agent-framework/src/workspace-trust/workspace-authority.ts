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
  readonly reader: IWorkspaceProjectReader;
}

const authorityRecords = new WeakMap<object, IWorkspaceAuthorityRecord>();

/** Internal production issuer. Deliberately absent from every package export barrel. */
export function mintWorkspaceProjectAuthority(
  identity: IWorkspaceIdentity,
  identityResolver: IWorkspaceIdentityResolver,
): IWorkspaceProjectAuthority {
  const authority = Object.freeze(Object.create(null)) as IWorkspaceProjectAuthority;
  authorityRecords.set(authority, {
    identity,
    reader: createWorkspaceProjectReader(identity, identityResolver),
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
