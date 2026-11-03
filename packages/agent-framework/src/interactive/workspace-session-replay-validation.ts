import { WorkspaceSessionLogSource } from './workspace-session-io.js';
import { computeSessionReplayValidationReport } from '../command-api/session/session-command-api.js';
import {
  WorkspaceAuthorityRequiredError,
  getWorkspaceProjectStateStorage,
} from '../workspace-trust/index.js';

import type { ICommandSessionReplayValidationReport } from '../command-api/index.js';
import type { TWorkspaceProjectAccess } from '../workspace-trust/index.js';
import type { ISessionStoreOptions } from '@robota-sdk/agent-session';

/**
 * The replay-validation report for a session's project log. `options.sealing` (required) opens a
 * sealed log; a sealed line this process cannot open throws `ArtifactLockedError` with its reason,
 * which the command reports as text.
 */
export function validateWorkspaceSessionReplayLog(
  projectAccess: TWorkspaceProjectAccess,
  sessionId: string,
  options: ISessionStoreOptions,
): ICommandSessionReplayValidationReport {
  if (projectAccess.status !== 'trusted') {
    throw new WorkspaceAuthorityRequiredError('Session replay validation requires project access.');
  }
  const logs = getWorkspaceProjectStateStorage(projectAccess.authority, 'session-logs');
  return computeSessionReplayValidationReport(
    new WorkspaceSessionLogSource(logs, sessionId, options),
    logs.projectRelativePath(`${sessionId}.jsonl`),
  );
}
