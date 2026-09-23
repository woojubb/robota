import { join } from 'node:path';

import { createNodeHostSettingsSource } from '@robota-sdk/agent-framework';

import { userPaths } from './user-paths.js';

import type { INodeHostSettingsSource } from '@robota-sdk/agent-framework';

export function robotaUserSettingsPath(
  home: string = process.env.HOME ?? process.env.USERPROFILE ?? '/',
): string {
  return userPaths(home).settings;
}

/** Ordered user settings layers selected by the Robota host. */
export function createRobotaUserSettingsSources(
  home: string = process.env.HOME ?? process.env.USERPROFILE ?? '/',
): readonly INodeHostSettingsSource[] {
  return [
    createNodeHostSettingsSource('user', robotaUserSettingsPath(home)),
    createNodeHostSettingsSource('user', join(home, '.claude', 'settings.json')),
  ];
}
