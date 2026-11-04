import {
  createProviderFromSettings,
  readProviderSettings,
} from '../command-api/provider/provider-factory.js';
import {
  describeProviderDestination,
  rememberProviderDestination,
} from '../advisor/provider-destination.js';
import type { IHostSettingsSource } from '../config/settings-source.js';
import type { TProviderEnvironment } from '../command-api/provider/provider-environment.js';

import { createProviderFromConfig } from '@robota-sdk/agent-core';
import type { IProviderDefinition, TProviderCredentialResolver } from '@robota-sdk/agent-core';

/** Resolve host-held credentials without putting their values into settings sources. */
export async function resolveUserSettingsProviderSwitchAsync(
  profileName: string,
  providerDefinitions: readonly IProviderDefinition[],
  sources: readonly IHostSettingsSource[],
  environment?: TProviderEnvironment,
  resolveCredential?: TProviderCredentialResolver,
): Promise<ReturnType<typeof resolveUserSettingsProviderSwitch>> {
  if (resolveCredential === undefined)
    return resolveUserSettingsProviderSwitch(
      profileName,
      providerDefinitions,
      sources,
      environment,
    );
  const unresolved = readProviderSettings(sources, {
    providerOverride: profileName,
    providerDefinitions,
    env: environment,
  });
  const settings = await resolveCredential(unresolved);
  const provider = createProviderFromConfig(settings, providerDefinitions);
  rememberProviderDestination(provider, describeProviderDestination(settings, providerDefinitions));
  return { settings, provider };
}

/** ARCH-043 residual: lazy switching is deliberately limited to explicit user-owned settings. */
export function resolveUserSettingsProviderSwitch(
  profileName: string,
  providerDefinitions: readonly IProviderDefinition[],
  sources: readonly IHostSettingsSource[],
  environment?: TProviderEnvironment,
): {
  settings: ReturnType<typeof readProviderSettings>;
  provider: ReturnType<typeof createProviderFromSettings>;
} {
  const options = {
    providerOverride: profileName,
    providerDefinitions,
    ...(environment !== undefined && { env: environment }),
  };
  const settings = readProviderSettings(sources, options);
  const provider = createProviderFromSettings(sources, undefined, options);
  // The advisor compares where it would send the conversation with where the main model now does.
  rememberProviderDestination(provider, describeProviderDestination(settings, providerDefinitions));
  return { settings, provider };
}
