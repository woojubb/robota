import { join } from 'node:path';

import { createNodeHostSettingsSource } from '@robota-sdk/agent-framework';

import { userPaths } from './user-paths.js';

import type { INodeHostSettingsSource } from '@robota-sdk/agent-framework';

/** Ordered user settings layers selected by the Robota host. */
export function createRobotaUserSettingsSources(
  home: string = process.env.HOME ?? process.env.USERPROFILE ?? '/',
): readonly INodeHostSettingsSource[] {
  return [
    createNodeHostSettingsSource('user', userPaths(home).settings),
    createNodeHostSettingsSource('user', join(home, '.claude', 'settings.json')),
  ];
}
