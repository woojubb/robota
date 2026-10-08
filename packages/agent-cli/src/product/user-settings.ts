import { join } from 'node:path';
import { createNodeHostSettingsSource } from '@robota-sdk/agent-framework';
import type { INodeHostSettingsSource } from '@robota-sdk/agent-framework';
import type { ICliRuntimeContext } from './runtime-context.js';

export function productUserSettingsPath(runtime: ICliRuntimeContext): string {
  return runtime.layout.userPaths.settings;
}

/** Explicit product settings plus the host-selected third-party compatibility layer. */
export function createProductUserSettingsSources(runtime: ICliRuntimeContext): readonly INodeHostSettingsSource[] {
  return [
    createNodeHostSettingsSource('user', productUserSettingsPath(runtime)),
    ...(runtime.userHome !== undefined
      ? (runtime.config.settings.sharedUserFiles ?? []).map((relativePath) =>
          createNodeHostSettingsSource('user', join(runtime.userHome!, relativePath)),
        )
      : []),
  ];
}
