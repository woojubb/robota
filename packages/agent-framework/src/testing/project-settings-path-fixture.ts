import { join } from 'node:path';

import type { IProjectSettingsPath } from '../config/settings-source.js';

/** Historical ConversationAgent/Claude layers used only by framework tests. */
export const TEST_PROJECT_SETTINGS_PATHS: readonly IProjectSettingsPath[] = [
  { scope: 'project', relativePath: join('.agent', 'settings.json') },
  { scope: 'project-local', relativePath: join('.agent', 'settings.local.json') },
  { scope: 'project', relativePath: join('.claude', 'settings.json') },
  { scope: 'project-local', relativePath: join('.claude', 'settings.local.json') },
];
