import {
  createProviderFromSettings,
  readProviderSettings,
} from '../command-api/provider/provider-factory.js';
import { createDefaultUserSettingsSources } from '../config/settings-source.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';

/** ARCH-043 residual: lazy switching is deliberately limited to explicit user-owned settings. */
export function resolveUserSettingsProviderSwitch(
  profileName: string,
  providerDefinitions: readonly IProviderDefinition[],
): {
  settings: ReturnType<typeof readProviderSettings>;
  provider: ReturnType<typeof createProviderFromSettings>;
} {
  const sources = createDefaultUserSettingsSources();
  const options = { providerOverride: profileName, providerDefinitions };
  return {
    settings: readProviderSettings(sources, options),
    provider: createProviderFromSettings(sources, undefined, options),
  };
}
