import { join } from 'node:path';

import type { TWorkspaceProjectStateDirectories } from '@robota-sdk/agent-framework';

/** Product-owned project state layout, shared by trusted storage and pre-trust preview. */
export const ROBOTA_PROJECT_STATE_DIRECTORIES: TWorkspaceProjectStateDirectories = Object.freeze({
  sessions: join('.robota', 'sessions'),
  'session-logs': join('.robota', 'logs'),
  memory: join('.robota', 'memory'),
  checkpoints: join('.robota', 'checkpoints'),
});
