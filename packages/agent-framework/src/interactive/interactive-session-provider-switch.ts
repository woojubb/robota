import {
  createProviderFromSettings,
  readProviderSettings,
} from '../command-api/provider/provider-factory.js';
import {
  describeProviderDestination,
  rememberProviderDestination,
} from '../advisor/provider-destination.js';
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
  const settings = readProviderSettings(sources, options);
  const provider = createProviderFromSettings(sources, undefined, options);
  // The advisor compares where it would send the conversation with where the main model now does.
  rememberProviderDestination(provider, describeProviderDestination(settings, providerDefinitions));
  return { settings, provider };
}
