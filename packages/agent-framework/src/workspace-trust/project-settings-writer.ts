import { join } from 'node:path';

import { assertProjectReadPurpose } from './project-reader-path.js';
import { writeWorkspaceRelativeFile } from './project-relative-writer.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';
import {
  assertWorkspaceProjectAuthority,
  getWorkspaceProjectIdentity,
  getWorkspaceProjectIdentityResolver,
} from './workspace-authority.js';

import type {
  IWorkspaceProjectAuthority,
  IWorkspaceProjectSettingsWriter,
  TWorkspaceProjectAuthorityCandidate,
  TWorkspaceProjectSettingsTarget,
  TWorkspaceProjectSettingsWriteDecision,
} from './types.js';

const projectSettingsWriters = new WeakSet<object>();

const SETTINGS_TARGETS: Readonly<Record<TWorkspaceProjectSettingsTarget, string>> = {
  project: join('.robota', 'settings.json'),
  'project-local': join('.robota', 'settings.local.json'),
};

class WorkspaceProjectSettingsWriter {
  readonly target: TWorkspaceProjectSettingsTarget;

  constructor(
    target: TWorkspaceProjectSettingsTarget,
    private readonly write: (content: string) => void,
  ) {
    this.target = target;
  }

  writeText(content: string): void {
    this.write(content);
  }
}

export function createWorkspaceProjectSettingsWriter(
  authority: IWorkspaceProjectAuthority,
  decision: TWorkspaceProjectSettingsWriteDecision,
): IWorkspaceProjectSettingsWriter {
  const accepted = assertWorkspaceProjectAuthority(authority);
  if (decision.status !== 'approved') {
    throw new WorkspaceAuthorityRequiredError(
      `Project settings write was not approved: ${decision.reason}.`,
    );
  }
  assertProjectReadPurpose(decision.purpose);
  const identity = getWorkspaceProjectIdentity(accepted);
  const identityResolver = getWorkspaceProjectIdentityResolver(accepted);
  const writer = Object.freeze(
    new WorkspaceProjectSettingsWriter(decision.target, (content) => {
      writeWorkspaceRelativeFile(
        identity,
        identityResolver,
        SETTINGS_TARGETS[decision.target],
        content,
      );
    }),
  );
  projectSettingsWriters.add(writer);
  return writer as IWorkspaceProjectSettingsWriter;
}

export function assertWorkspaceProjectSettingsWriter(
  candidate: TWorkspaceProjectAuthorityCandidate,
): IWorkspaceProjectSettingsWriter {
  if (
    (typeof candidate !== 'object' && typeof candidate !== 'function') ||
    candidate === null ||
    !projectSettingsWriters.has(candidate)
  ) {
    throw new WorkspaceAuthorityRequiredError(
      'A separately approved workspace project settings writer is required.',
    );
  }
  return candidate as IWorkspaceProjectSettingsWriter;
}
