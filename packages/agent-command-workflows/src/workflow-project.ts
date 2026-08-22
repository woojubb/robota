import {
  WorkspaceAuthorityRequiredError,
  assertWorkspaceProjectAuthority,
  assertWorkspaceProjectMutationForAuthority,
  getWorkspaceProjectIdentity,
  getWorkspaceProjectReader,
} from '@robota-sdk/agent-framework';

import type {
  IWorkspaceDirectoryEntry,
  IWorkspaceProjectAuthority,
  IWorkspaceProjectMutation,
} from '@robota-sdk/agent-framework';

declare const workflowProjectType: unique symbol;

/** Exact-instance workflow view derived from one workspace authority. */
export interface IWorkflowProject {
  readonly [workflowProjectType]: true;
  readonly executionRoot: string;
  readonly canMutate: boolean;
  readText(relativePath: string, purpose: string): string | undefined;
  listDirectory(relativePath: string, purpose: string): readonly IWorkspaceDirectoryEntry[];
  inspectKind(
    relativePath: string,
    purpose: string,
  ): 'file' | 'directory' | 'link' | 'other' | undefined;
  writeText(relativePath: string, content: string, purpose: string): void;
}

const workflowProjects = new WeakSet<object>();

class WorkspaceWorkflowProject {
  readonly executionRoot: string;
  readonly canMutate: boolean;

  constructor(
    authority: IWorkspaceProjectAuthority,
    private readonly mutation: IWorkspaceProjectMutation | undefined,
  ) {
    const acceptedAuthority = assertWorkspaceProjectAuthority(authority);
    this.reader = getWorkspaceProjectReader(acceptedAuthority);
    this.executionRoot = getWorkspaceProjectIdentity(acceptedAuthority).worktreeRoot;
    this.canMutate = mutation !== undefined;
    if (mutation !== undefined) {
      assertWorkspaceProjectMutationForAuthority(mutation, acceptedAuthority);
    }
  }

  private readonly reader;

  readText(relativePath: string, purpose: string): string | undefined {
    return this.reader.readText(relativePath, purpose);
  }

  listDirectory(relativePath: string, purpose: string): readonly IWorkspaceDirectoryEntry[] {
    return this.reader.listDirectory(relativePath, purpose);
  }

  inspectKind(
    relativePath: string,
    purpose: string,
  ): 'file' | 'directory' | 'link' | 'other' | undefined {
    return this.reader.inspectKind(relativePath, purpose);
  }

  writeText(relativePath: string, content: string, purpose: string): void {
    if (this.mutation === undefined) {
      throw new WorkspaceAuthorityRequiredError(
        'Workflow project mutation requires an explicit approved capability.',
      );
    }
    this.mutation.writeBytes(relativePath, Buffer.from(content), purpose);
  }
}

export function createWorkspaceWorkflowProject(
  authority: IWorkspaceProjectAuthority,
  mutation?: IWorkspaceProjectMutation,
): IWorkflowProject {
  const project = Object.freeze(new WorkspaceWorkflowProject(authority, mutation));
  workflowProjects.add(project);
  return project as IWorkflowProject;
}

export function assertWorkflowProject(candidate: unknown): IWorkflowProject {
  if (
    (typeof candidate !== 'object' && typeof candidate !== 'function') ||
    candidate === null ||
    !workflowProjects.has(candidate)
  ) {
    throw new WorkspaceAuthorityRequiredError(
      'WorkspaceAuthorityRequired: an explicit workflow project capability is required.',
    );
  }
  return candidate as IWorkflowProject;
}
