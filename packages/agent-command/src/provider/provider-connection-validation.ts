import { normalizeProviderConfig } from '@robota-sdk/agent-core';
import { resolveProviderEnvironment, validateProviderProfile } from '@robota-sdk/agent-framework';

import type {
  IProviderCommandModuleOptions,
  IProviderProfileSettings,
} from '@robota-sdk/agent-framework';

/** A settings change must not commit a connection its host can no longer resolve. */
export async function validateProviderConnection(
  profileName: string,
  profile: IProviderProfileSettings,
  options: IProviderCommandModuleOptions,
): Promise<void> {
  validateProviderProfile(profileName, profile, {
    providerDefinitions: options.providerDefinitions,
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  if (profile.apiKeyRef === undefined) return;
  try {
    if (options.resolveCredential === undefined)
      throw new Error('Host credential resolution unavailable.');
    const resolved = await options.resolveCredential(
      normalizeProviderConfig(
        {
          name: profile.type!,
          model: profile.model,
          apiKeyRef: profile.apiKeyRef,
          baseURL: profile.baseURL,
        },
        options.providerDefinitions,
        // A saved connection names a host credential, not an environment variable, so the
        // normalizer never consults this resolver; it reads the host's snapshot all the same.
        resolveProviderEnvironment(options.env),
      ),
    );
    if (!resolved.apiKey?.trim()) throw new Error('Host credential unavailable.');
  } catch {
    throw new Error(`Saved connection unavailable. Run /provider reconnect ${profileName}.`);
  }
}
