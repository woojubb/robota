import {
  buildProviderSetupPatch,
  formatOrgPolicyViolationMessage,
  isApiKeyPlaintext,
  setCurrentProvider,
  upsertProviderProfile,
} from '@robota-sdk/agent-framework';

import { runProviderSetupAsk } from './provider-command-setup.js';
import { createProviderSetupFlow } from './provider-setup-flow.js';

import type { IUserInteraction } from '@robota-sdk/agent-core';
import type {
  IProviderCommandModuleOptions,
  IProviderProfileSettings,
  IProviderSetupInput,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

export function formatProviderChoiceLabel(
  name: string,
  profile: IProviderProfileSettings,
  currentProvider: string | undefined,
): string {
  const marker = name === currentProvider ? '* ' : '';
  return `${marker}${name}: ${profile.type ?? 'unknown'} ${profile.model ?? '(no model)'}`;
}

export function buildProviderSwitch(
  providers: Record<string, IProviderProfileSettings> | undefined,
  profileName: string | undefined,
  options: IProviderCommandModuleOptions,
): ICommandResult {
  if (!profileName) {
    return { message: 'Usage: /provider switch <profile>', success: false };
  }
  if (!providers?.[profileName]) {
    return { message: `Provider profile "${profileName}" was not found.`, success: false };
  }
  const { orgPolicy } = options;
  if (orgPolicy?.allowedProviders && !orgPolicy.allowedProviders.includes(profileName)) {
    return {
      message: formatOrgPolicyViolationMessage(
        `Provider "${profileName}" is not allowed by your organization policy. Allowed: ${orgPolicy.allowedProviders.join(', ')}.`,
        orgPolicy.adminContact,
      ),
      success: false,
    };
  }
  if (options.settings.readMergedSettings().currentProvider === profileName) {
    return { message: `Already using provider "${profileName}".`, success: true };
  }
  const profile = providers[profileName];
  const target = options.settings.readTargetSettings();
  const merged = options.settings.readMergedSettings();
  const next =
    target.providers?.[profileName] !== undefined || merged.providers?.[profileName] !== undefined
      ? { ...target, currentProvider: profileName }
      : setCurrentProvider(target, profileName);
  options.settings.writeTargetSettings(next);
  const modelLabel = profile.model ?? 'unknown model';
  return {
    message: `Switched to ${profileName} (${modelLabel}). History preserved.`,
    success: true,
    hostActions: [{ type: 'provider-hot-swap', profileName }],
  };
}

export async function buildProviderEdit(
  ui: IUserInteraction,
  profileName: string,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  const settings = options.settings.readMergedSettings();
  const profile = settings.providers?.[profileName];
  if (!profile) {
    return { message: `Provider profile "${profileName}" was not found.`, success: false };
  }
  if (!profile.type) {
    return { message: `Provider profile "${profileName}" is missing type.`, success: false };
  }
  let flow;
  try {
    flow = createProviderSetupFlow(profile.type, options.providerDefinitions, {
      profileName,
      setCurrent: false,
      initialValues: getProviderProfileSetupValues(profile),
    });
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error), success: false };
  }
  return runProviderSetupAsk(
    ui,
    flow,
    (input) => completeProviderEdit(input, profileName, options),
    'Provider edit cancelled.',
  );
}

function getProviderProfileSetupValues(profile: IProviderProfileSettings): {
  model?: string;
  apiKey?: string;
  baseURL?: string;
} {
  return {
    ...(typeof profile.model === 'string' ? { model: profile.model } : {}),
    ...(typeof profile.apiKey === 'string' ? { apiKey: profile.apiKey } : {}),
    ...(typeof profile.baseURL === 'string' ? { baseURL: profile.baseURL } : {}),
  };
}

function completeProviderEdit(
  input: IProviderSetupInput,
  profileName: string,
  options: IProviderCommandModuleOptions,
): ICommandResult {
  const merged = options.settings.readMergedSettings();
  const currentProfile = merged.providers?.[profileName];
  if (!currentProfile) {
    return { message: `Provider profile "${profileName}" was not found.`, success: false };
  }
  const { orgPolicy } = options;
  if (orgPolicy?.requireApiKeyFromEnv && isApiKeyPlaintext(input.apiKey)) {
    return {
      message: formatOrgPolicyViolationMessage(
        'Your organization policy requires API keys to be stored as environment variable references ($ENV:VAR_NAME), not as plaintext.',
        orgPolicy.adminContact,
      ),
      success: false,
    };
  }
  const target = options.settings.readTargetSettings();
  const patch = buildProviderSetupPatch(input, {
    providerDefinitions: options.providerDefinitions,
  });
  const updatedProfile = patch.providers[profileName];
  if (!updatedProfile) {
    return { message: `Provider profile "${profileName}" was not updated.`, success: false };
  }
  options.settings.writeTargetSettings(
    upsertProviderProfile(target, profileName, { ...currentProfile, ...updatedProfile }),
  );
  const isCurrent = merged.currentProvider === profileName;
  return {
    message: isCurrent
      ? `Provider ${profileName} updated. Switching...`
      : `Provider ${profileName} updated.`,
    success: true,
    ...(isCurrent ? { hostActions: [{ type: 'provider-hot-swap' as const, profileName }] } : {}),
  };
}
