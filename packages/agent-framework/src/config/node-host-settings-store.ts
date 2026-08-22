import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { SettingsParseError } from './settings-parse-error.js';
import { createNodeHostSettingsSource } from './settings-source.js';

import type { TSettingsData } from './settings-io.js';
import type { THostSettingsScope } from './settings-source.js';
import type { ISettingsDocumentStore } from './settings-store.js';

export function createNodeHostSettingsStore(
  scope: THostSettingsScope,
  path: string,
): ISettingsDocumentStore {
  const source = createNodeHostSettingsSource(scope, path);
  return Object.freeze({
    kind: 'host' as const,
    scope,
    displayName: path,
    source,
    read: (): TSettingsData => {
      if (!existsSync(path)) return {};
      const raw = readFileSync(path, 'utf8');
      try {
        return JSON.parse(raw) as TSettingsData;
      } catch (error) {
        throw new SettingsParseError(path, error instanceof Error ? error.message : String(error));
      }
    },
    write: (settings: TSettingsData): void => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
    },
  });
}
