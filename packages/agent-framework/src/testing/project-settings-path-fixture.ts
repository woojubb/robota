import type { IProjectSettingsPath } from '../config/settings-source.js';

/** Historical ConversationAgent/Claude layers used only by framework tests. */
export const TEST_PROJECT_SETTINGS_PATHS: readonly IProjectSettingsPath[] = [
  { scope: 'project', relativePath: '.agent/settings.json' },
  { scope: 'project-local', relativePath: '.agent/settings.local.json' },
  { scope: 'project', relativePath: '.claude/settings.json' },
  { scope: 'project-local', relativePath: '.claude/settings.local.json' },
];
