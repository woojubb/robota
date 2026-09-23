import { join } from 'node:path';

import type { IProjectSettingsPath } from '@robota-sdk/agent-framework';

/** Product-owned project settings layers, in merge priority order. */
export const ROBOTA_PROJECT_SETTINGS: readonly IProjectSettingsPath[] = [
  { scope: 'project', relativePath: join('.robota', 'settings.json') },
  { scope: 'project-local', relativePath: join('.robota', 'settings.local.json') },
  { scope: 'project', relativePath: join('.claude', 'settings.json') },
  { scope: 'project-local', relativePath: join('.claude', 'settings.local.json') },
];
