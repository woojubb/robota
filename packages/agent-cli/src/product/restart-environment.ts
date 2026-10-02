import { ENV_REFERENCE_PREFIX, type IProviderDefinition } from '@robota-sdk/agent-core';
import { TRANSPORT_ENVIRONMENT } from '@robota-sdk/agent-executor';
import { readMergedProviderSettings, type TSettingsSource } from '@robota-sdk/agent-framework';

import { childProductEnvironment } from './child-environment.js';

import type { ICliRuntimeContext } from './runtime-context.js';

/** Names are collected from admitted settings and definitions without reading environment values. */
export function providerEnvironmentReferences(
  settingsSources: readonly TSettingsSource[],
  providerDefinitions: readonly IProviderDefinition[],
): readonly string[] {
  const settings = readMergedProviderSettings(settingsSources);
  const references = new Set<string>(TRANSPORT_ENVIRONMENT);
  const collect = (value: string | undefined): void => {
    if (value?.startsWith(ENV_REFERENCE_PREFIX) !== true) return;
    const name = value.slice(ENV_REFERENCE_PREFIX.length).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) references.add(name);
  };
  collect(settings.provider?.apiKey);
  for (const profile of Object.values(settings.providers ?? {})) collect(profile.apiKey);
  for (const definition of providerDefinitions) {
    collect(definition.defaults?.apiKey);
    for (const name of definition.destinationEnvironment ?? []) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) references.add(name);
    }
  }
  return [...references].sort();
}

/** A full CLI restart reopens its explicitly selected file and carries only named provider refs. */
export function restartProductEnvironment(
  runtime: ICliRuntimeContext,
  settingsSources: readonly TSettingsSource[],
  providerDefinitions: readonly IProviderDefinition[],
): NodeJS.ProcessEnv {
  const environment = childProductEnvironment(runtime);
  const selectedFile = runtime.environment.PRODUCT_CONFIG_FILE;
  if (selectedFile !== undefined && selectedFile !== '') environment.PRODUCT_CONFIG_FILE = selectedFile;
  for (const name of providerEnvironmentReferences(settingsSources, providerDefinitions)) {
    const value = runtime.environment[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}
