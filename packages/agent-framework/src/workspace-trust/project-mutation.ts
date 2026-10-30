import { createStableRootedFileWriter } from '@robota-sdk/agent-file-authority';
import {
  assertCurrentWorkspaceIdentity,
  assertProjectReadPurpose,
  workspacePathSegments,
} from './project-reader-path.js';
import { createWorkspaceProjectMutationBoundary } from './project-relative-writer.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';
import {
  assertWorkspaceProjectAuthority,
  getWorkspaceProjectIdentity,
  getWorkspaceProjectIdentityResolver,
} from './workspace-authority.js';

import type { IWorkspaceProjectMutationBoundary } from './project-relative-writer.js';
import type {
  IWorkspaceProjectAuthority,
  IWorkspaceProjectMutation,
  TWorkspaceProjectAuthorityCandidate,
  TWorkspaceProjectMutationDecision,
} from './types.js';

const projectMutations = new WeakMap<object, IWorkspaceProjectAuthority>();

/** Retain the project directory before asking a human to approve this single workflow operation. */
export function prepareWorkflowJsonMutation(authority: IWorkspaceProjectAuthority): {
  approve(decision: TWorkspaceProjectMutationDecision): IWorkspaceProjectMutation;
  close(): void;
} {
  const accepted = assertWorkspaceProjectAuthority(authority);
  const identity = getWorkspaceProjectIdentity(accepted);
  const resolver = getWorkspaceProjectIdentityResolver(accepted);
  assertCurrentWorkspaceIdentity(identity, resolver);
  const writer = createStableRootedFileWriter(identity.worktreeRoot);
  let open = true;
  let approved = false;
  const verify = (): void => {
    if (!open) throw new WorkspaceAuthorityRequiredError('Workflow write approval has ended.');
    assertWorkspaceProjectAuthority(accepted);
    assertCurrentWorkspaceIdentity(identity, resolver);
    writer.assertNamedRoot();
  };
  try {
    verify();
  } catch (error) {
    writer.close();
    throw error;
  }
  return Object.freeze({
    approve(decision: TWorkspaceProjectMutationDecision): IWorkspaceProjectMutation {
      if (approved)
        throw new WorkspaceAuthorityRequiredError('Workflow write approval was already used.');
      if (decision.status !== 'approved')
        throw new WorkspaceAuthorityRequiredError('Workflow write approval was denied.');
      assertProjectReadPurpose(decision.purpose);
      verify();
      approved = true;
      const mutation = Object.freeze({
        writeBytes(relativePath: string, content: Uint8Array, purpose: string): void {
          verify();
          assertProjectReadPurpose(purpose);
          const segments = workspacePathSegments(relativePath);
          if (
            segments.length < 2 ||
            segments[0] !== '.workflows' ||
            !segments.at(-1)?.endsWith('.json')
          ) {
            throw new WorkspaceAuthorityRequiredError(
              'Workflow writes are limited to JSON under .workflows.',
            );
          }
          let text: string;
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(content);
            JSON.parse(text);
          } catch {
            throw new WorkspaceAuthorityRequiredError('Workflow writes require valid UTF-8 JSON.');
          }
          writer.writeUtf8WhileNamed(segments, text);
          verify();
        },
        deleteFile(_relativePath: string, _purpose: string): boolean {
          throw new WorkspaceAuthorityRequiredError(
            'Workflow write approval does not permit deletion.',
          );
        },
      });
      projectMutations.set(mutation, accepted);
      return mutation as IWorkspaceProjectMutation;
    },
    close(): void {
      if (!open) return;
      open = false;
      writer.close();
    },
  });
}

class WorkspaceProjectMutation {
  constructor(
    private readonly authority: IWorkspaceProjectAuthority,
    private readonly boundary: IWorkspaceProjectMutationBoundary,
  ) {}

  writeBytes(relativePath: string, content: Uint8Array, purpose: string): void {
    assertWorkspaceProjectAuthority(this.authority);
    assertProjectReadPurpose(purpose);
    this.boundary.write(relativePath, content);
  }

  deleteFile(relativePath: string, purpose: string): boolean {
    assertWorkspaceProjectAuthority(this.authority);
    assertProjectReadPurpose(purpose);
    return this.boundary.delete(relativePath);
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
      accepted,
      createWorkspaceProjectMutationBoundary(
        getWorkspaceProjectIdentity(accepted),
        getWorkspaceProjectIdentityResolver(accepted),
      ),
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
  assertWorkspaceProjectAuthority(projectMutations.get(candidate)!);
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
