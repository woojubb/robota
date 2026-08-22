import { WorkspaceSessionLogSource } from './workspace-session-io.js';
import { computeSessionReplayValidationReport } from '../command-api/session/session-command-api.js';
import {
  WorkspaceAuthorityRequiredError,
  getWorkspaceProjectStateStorage,
} from '../workspace-trust/index.js';

import type { ICommandSessionReplayValidationReport } from '../command-api/index.js';
import type { TWorkspaceProjectAccess } from '../workspace-trust/index.js';

export function validateWorkspaceSessionReplayLog(
  projectAccess: TWorkspaceProjectAccess,
  sessionId: string,
): ICommandSessionReplayValidationReport {
  if (projectAccess.status !== 'trusted') {
    throw new WorkspaceAuthorityRequiredError('Session replay validation requires project access.');
  }
  const logs = getWorkspaceProjectStateStorage(projectAccess.authority, 'session-logs');
  return computeSessionReplayValidationReport(
    new WorkspaceSessionLogSource(logs, sessionId),
    `.robota/logs/${sessionId}.jsonl`,
  );
}
