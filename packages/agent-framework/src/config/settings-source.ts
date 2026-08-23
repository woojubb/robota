import { join } from 'node:path';

import {
  createNodeHostSettingsSource,
  readNodeHostSettingsSource,
} from './node-host-settings-source.js';
import { assertWorkspaceProjectReader } from '../workspace-trust/index.js';

import type { INodeHostSettingsSource } from './node-host-settings-source.js';
import type { IWorkspaceProjectReader } from '../workspace-trust/index.js';

export type THostSettingsScope = 'managed' | 'user';
export type TProjectSettingsScope = 'project' | 'project-local';

export interface IWorkspaceProjectSettingsSource {
  readonly kind: 'project';
  readonly scope: TProjectSettingsScope;
  readonly displayName: string;
  readonly relativePath: string;
  readonly reader: IWorkspaceProjectReader;
}

export type TSettingsSource = INodeHostSettingsSource | IWorkspaceProjectSettingsSource;

const PROJECT_SETTINGS: ReadonlyArray<
  Readonly<{ scope: TProjectSettingsScope; relativePath: string }>
> = [
  { scope: 'project', relativePath: join('.robota', 'settings.json') },
  { scope: 'project-local', relativePath: join('.robota', 'settings.local.json') },
  { scope: 'project', relativePath: join('.claude', 'settings.json') },
  { scope: 'project-local', relativePath: join('.claude', 'settings.local.json') },
];

export { createNodeHostSettingsSource };

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
): readonly IWorkspaceProjectSettingsSource[] {
  const accepted = assertWorkspaceProjectReader(reader);
  return PROJECT_SETTINGS.map(({ scope, relativePath }) =>
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
