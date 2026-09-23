import {
  createProviderFromSettings,
  readProviderSettings,
} from '../command-api/provider/provider-factory.js';
import type { INodeHostSettingsSource } from '../config/node-host-settings-source.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';

/** ARCH-043 residual: lazy switching is deliberately limited to explicit user-owned settings. */
export function resolveUserSettingsProviderSwitch(
  profileName: string,
  providerDefinitions: readonly IProviderDefinition[],
  sources: readonly INodeHostSettingsSource[],
): {
  settings: ReturnType<typeof readProviderSettings>;
  provider: ReturnType<typeof createProviderFromSettings>;
} {
  const options = { providerOverride: profileName, providerDefinitions };
  return {
    settings: readProviderSettings(sources, options),
    provider: createProviderFromSettings(sources, undefined, options),
  };
}
