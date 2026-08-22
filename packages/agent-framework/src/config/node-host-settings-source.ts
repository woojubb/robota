import { existsSync, readFileSync } from 'node:fs';

import type { THostSettingsScope } from './settings-source.js';

export interface INodeHostSettingsSource {
  readonly kind: 'host';
  readonly scope: THostSettingsScope;
  readonly displayName: string;
  readonly path: string;
}

/** Explicit process-namespace adapter for managed or user-owned settings files. */
export function createNodeHostSettingsSource(
  scope: THostSettingsScope,
  path: string,
): INodeHostSettingsSource {
  return Object.freeze({ kind: 'host', scope, displayName: path, path });
}

export function readNodeHostSettingsSource(source: INodeHostSettingsSource): string | undefined {
  if (!existsSync(source.path)) return undefined;
  return readFileSync(source.path, 'utf8');
}
