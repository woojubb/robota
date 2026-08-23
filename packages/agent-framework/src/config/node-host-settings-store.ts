import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { ensureOwnerOnlyDirectory, tightenExistingFile } from '@robota-sdk/agent-core/node';

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
      // SEC-020: the directory was created with no mode, and `mode` on the write below applies
      // only at creation — so the settings directory was 0755 and a file an older version left
      // at 0644 stayed there through every rewrite.
      ensureOwnerOnlyDirectory(dirname(path));
      tightenExistingFile(path);
      writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
    },
  });
}
