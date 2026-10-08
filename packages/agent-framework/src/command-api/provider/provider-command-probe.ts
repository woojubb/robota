import {
  findProviderDefinition,
  isEnvReference,
  resolveEnvReference,
} from '@robota-sdk/agent-core';

import { validateProviderProfile, type IProviderProfileSettings } from './provider-settings.js';

import type { ICommandResult } from '../command-result.js';
import type { IProviderCommandModuleOptions } from './provider-command-types.js';
import type { IProviderProbeResult, IProviderProfileConfig } from '@robota-sdk/agent-core';

export async function testProviderProfileCommand(
  currentProvider: string | undefined,
  providers: Record<string, IProviderProfileSettings> | undefined,
  profileArg: string | undefined,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  const profileName = profileArg ?? currentProvider;
  if (!profileName) {
    return { message: 'No provider profile selected.', success: false };
  }
  const profile = providers?.[profileName];
  if (!profile) {
    return { message: `Provider profile "${profileName}" was not found.`, success: false };
  }
  try {
    validateProviderProfile(profileName, profile, {
      providerDefinitions: options.providerDefinitions,
      ...(options.env === undefined ? {} : { env: options.env }),
    });
  } catch (error) {
    const referenceHint =
      profile.apiKey !== undefined && isEnvReference(profile.apiKey)
        ? ` Check ${profile.apiKey} in the host environment.`
        : '';
    return {
      message: `${error instanceof Error ? error.message : String(error)}.${referenceHint} Run /provider edit ${profileName} to correct the profile.`,
      success: false,
    };
  }
  const definition = profile.type
    ? findProviderDefinition(options.providerDefinitions, profile.type)
    : undefined;
  const probe = definition?.probeProfile ?? probeProviderProfile;
  const apiKey =
    profile.apiKey === undefined
      ? undefined
      : resolveEnvReference(profile.apiKey, (name) => (options.env ?? process.env)[name]);
  const result = await probe({ ...profile, ...(apiKey === undefined ? {} : { apiKey }) });
  return {
    message: result.ok
      ? `Provider "${profileName}" test passed: ${result.message}`
      : `Provider "${profileName}" test failed: ${result.message}; manual configuration can continue. Run /provider edit ${profileName} to check the URL, model and API key.`,
    success: true,
    data: { providerTest: { profile: profileName } },
  };
}

export async function probeProviderProfile(
  profile: IProviderProfileConfig,
): Promise<IProviderProbeResult> {
  void profile;
  return { ok: true, message: 'Profile fields are valid; no endpoint probe configured.' };
}
