import { existsSync, readFileSync } from 'node:fs';

import type { THostSettingsScope } from './settings-scope-types.js';
import type { IHostSettingsSource } from './settings-source.js';

/**
 * Explicit process-namespace adapter for managed or user-owned settings files. A missing file reads
 * as absent; a file that exists but cannot be read throws.
 */
export function createNodeHostSettingsSource(
  scope: THostSettingsScope,
  path: string,
): IHostSettingsSource {
  return Object.freeze({
    kind: 'host' as const,
    scope,
    displayName: path,
    path,
    read: (): string | undefined => {
      if (!existsSync(path)) return undefined;
      return readFileSync(path, 'utf8');
    },
  });
}
