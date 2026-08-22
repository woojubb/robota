import { assertProjectReadPurpose } from './project-reader-path.js';
import {
  deleteWorkspaceRelativeFile,
  writeWorkspaceRelativeFile,
} from './project-relative-writer.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';
import {
  assertWorkspaceProjectAuthority,
  getWorkspaceProjectIdentity,
  getWorkspaceProjectIdentityResolver,
} from './workspace-authority.js';

import type {
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceProjectAuthority,
  IWorkspaceProjectMutation,
  TWorkspaceProjectAuthorityCandidate,
  TWorkspaceProjectMutationDecision,
} from './types.js';

const projectMutations = new WeakMap<object, IWorkspaceProjectAuthority>();

class WorkspaceProjectMutation {
  constructor(
    private readonly identity: IWorkspaceIdentity,
    private readonly identityResolver: IWorkspaceIdentityResolver,
  ) {}

  writeBytes(relativePath: string, content: Uint8Array, purpose: string): void {
    assertProjectReadPurpose(purpose);
    writeWorkspaceRelativeFile(this.identity, this.identityResolver, relativePath, content);
  }

  deleteFile(relativePath: string, purpose: string): boolean {
    assertProjectReadPurpose(purpose);
    return deleteWorkspaceRelativeFile(this.identity, this.identityResolver, relativePath);
  }
}

export function createWorkspaceProjectMutation(
  authority: IWorkspaceProjectAuthority,
  decision: TWorkspaceProjectMutationDecision,
): IWorkspaceProjectMutation {
  const accepted = assertWorkspaceProjectAuthority(authority);
  if (decision.status !== 'approved') {
    throw new WorkspaceAuthorityRequiredError(
      `Project mutation permission was denied: ${decision.reason}`,
    );
  }
  assertProjectReadPurpose(decision.purpose);
  const mutation = Object.freeze(
    new WorkspaceProjectMutation(
      getWorkspaceProjectIdentity(accepted),
      getWorkspaceProjectIdentityResolver(accepted),
    ),
  );
  projectMutations.set(mutation, accepted);
  return mutation as IWorkspaceProjectMutation;
}

export function assertWorkspaceProjectMutation(
  candidate: TWorkspaceProjectAuthorityCandidate,
): IWorkspaceProjectMutation {
  if (
    (typeof candidate !== 'object' && typeof candidate !== 'function') ||
    candidate === null ||
    !projectMutations.has(candidate)
  ) {
    throw new WorkspaceAuthorityRequiredError(
      'A runtime-minted workspace project mutation capability is required.',
    );
  }
  return candidate as IWorkspaceProjectMutation;
}

/** Internal same-grant check for adapters that combine reads/state with project mutation. */
export function assertWorkspaceProjectMutationForAuthority(
  mutation: IWorkspaceProjectMutation,
  authority: IWorkspaceProjectAuthority,
): IWorkspaceProjectMutation {
  const acceptedMutation = assertWorkspaceProjectMutation(mutation);
  const acceptedAuthority = assertWorkspaceProjectAuthority(authority);
  if (projectMutations.get(acceptedMutation) !== acceptedAuthority) {
    throw new WorkspaceAuthorityRequiredError(
      'Project mutation capability does not belong to the supplied workspace authority.',
    );
  }
  return acceptedMutation;
}
