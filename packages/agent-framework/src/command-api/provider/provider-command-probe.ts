import type { IProviderProbeResult, IProviderProfileConfig } from '@robota-sdk/agent-core';
import { findProviderDefinition } from '@robota-sdk/agent-core';
import type { ICommandResult } from '../command-result.js';
import type { IProviderCommandModuleOptions } from './provider-command-types.js';
import { validateProviderProfile, type IProviderProfileSettings } from './provider-settings.js';

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
    });
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error), success: false };
  }
  const definition = profile.type
    ? findProviderDefinition(options.providerDefinitions, profile.type)
    : undefined;
  const probe = definition?.probeProfile ?? probeProviderProfile;
  const result = await probe(profile);
  return {
    message: result.ok
      ? `Provider "${profileName}" test passed: ${result.message}`
      : `Provider "${profileName}" test failed: ${result.message}; manual configuration can continue.`,
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
