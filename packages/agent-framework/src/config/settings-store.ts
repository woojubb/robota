import { join } from 'node:path';

import { createNodeHostSettingsStore } from './node-host-settings-store.js';
import { SettingsParseError } from './settings-parse-error.js';
import { getWorkspaceProjectReader } from '../workspace-trust/index.js';
import { assertWorkspaceProjectSettingsWriterForAuthority } from '../workspace-trust/project-settings-writer.js';

import type { TSettingsData } from './settings-io.js';
import type {
  TSettingsSource,
  THostSettingsScope,
  TProjectSettingsScope,
} from './settings-source.js';
import type {
  IWorkspaceProjectAuthority,
  IWorkspaceProjectSettingsWriter,
} from '../workspace-trust/index.js';

export interface ISettingsDocumentStore {
  readonly kind: 'host' | 'project';
  readonly scope: THostSettingsScope | TProjectSettingsScope;
  readonly displayName: string;
  readonly source: TSettingsSource;
  read(): TSettingsData;
  write(settings: TSettingsData): void;
}

const ROBOTA_SETTINGS_PATHS: Readonly<Record<TProjectSettingsScope, string>> = {
  project: join('.robota', 'settings.json'),
  'project-local': join('.robota', 'settings.local.json'),
};

export { createNodeHostSettingsStore };

export function createWorkspaceProjectSettingsStore(
  authority: IWorkspaceProjectAuthority,
  writer: IWorkspaceProjectSettingsWriter,
): ISettingsDocumentStore {
  const acceptedWriter = assertWorkspaceProjectSettingsWriterForAuthority(writer, authority);
  const reader = getWorkspaceProjectReader(authority);
  const scope = acceptedWriter.target;
  const relativePath = ROBOTA_SETTINGS_PATHS[scope];
  const source = Object.freeze({
    kind: 'project' as const,
    scope,
    displayName: relativePath,
    relativePath,
    reader,
  });
  return Object.freeze({
    kind: 'project' as const,
    scope,
    displayName: relativePath,
    source,
    read: (): TSettingsData => {
      const raw = reader.readText(relativePath, 'read project settings for update');
      if (raw === undefined) return {};
      try {
        return JSON.parse(raw) as TSettingsData;
      } catch (error) {
        throw new SettingsParseError(
          relativePath,
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    write: (settings: TSettingsData): void => {
      acceptedWriter.writeText(`${JSON.stringify(settings, null, 2)}\n`);
    },
  });
}
