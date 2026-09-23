import { join } from 'node:path';

import {
  createNodeHostSettingsSource,
  readNodeHostSettingsSource,
} from './node-host-settings-source.js';
import { assertWorkspaceProjectReader } from '../workspace-trust/index.js';

import type { INodeHostSettingsSource } from './node-host-settings-source.js';
import type { IWorkspaceProjectReader } from '../workspace-trust/index.js';

export type { THostSettingsScope } from './settings-scope-types.js';
export type TProjectSettingsScope = 'project' | 'project-local';

export interface IWorkspaceProjectSettingsSource {
  readonly kind: 'project';
  readonly scope: TProjectSettingsScope;
  readonly displayName: string;
  readonly relativePath: string;
  readonly reader: IWorkspaceProjectReader;
}

export type TSettingsSource = INodeHostSettingsSource | IWorkspaceProjectSettingsSource;

export interface IProjectSettingsPath {
  readonly scope: TProjectSettingsScope;
  readonly relativePath: string;
}

export { createNodeHostSettingsSource };
export type { INodeHostSettingsSource } from './node-host-settings-source.js';

/** Default host-owned layers. Project paths are intentionally absent. */
export function createDefaultUserSettingsSources(
  userHome: string = process.env.HOME ?? process.env.USERPROFILE ?? '/',
): readonly INodeHostSettingsSource[] {
  return [
    createNodeHostSettingsSource('user', join(userHome, '.robota', 'settings.json')),
    createNodeHostSettingsSource('user', join(userHome, '.claude', 'settings.json')),
  ];
}

/** Project layers bound to a runtime-accepted root-relative reader. */
export function createWorkspaceProjectSettingsSources(
  reader: IWorkspaceProjectReader,
  paths: readonly IProjectSettingsPath[],
): readonly IWorkspaceProjectSettingsSource[] {
  const accepted = assertWorkspaceProjectReader(reader);
  return paths.map(({ scope, relativePath }) =>
    Object.freeze({
      kind: 'project' as const,
      scope,
      displayName: relativePath,
      relativePath,
      reader: accepted,
    }),
  );
}

export function readSettingsSourceText(
  source: TSettingsSource,
  purpose: string,
): string | undefined {
  if (source.kind === 'host') return readNodeHostSettingsSource(source);
  return assertWorkspaceProjectReader(source.reader).readText(source.relativePath, purpose);
}
