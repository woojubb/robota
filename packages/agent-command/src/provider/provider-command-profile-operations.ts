import {
  buildProviderSetupPatch,
  formatOrgPolicyViolationMessage,
  isApiKeyPlaintext,
  setCurrentProvider,
  upsertProviderProfile,
} from '@robota-sdk/agent-framework';

import { runProviderSetupAsk } from './provider-command-setup.js';
import { createProviderSetupFlow } from './provider-setup-flow.js';
import {
  hasProviderConnectionMethods,
  runProviderConnectionSetup,
} from './provider-connection-setup.js';
import { validateProviderConnection } from './provider-connection-validation.js';

import type { IUserInteraction } from '@robota-sdk/agent-core';
import type {
  IProviderCommandModuleOptions,
  IProviderProfileSettings,
  IProviderSetupInput,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

export function formatProviderChoiceLabel(
  name: string,
  profile: IProviderProfileSettings,
  currentProvider: string | undefined,
): string {
  const marker = name === currentProvider ? '* ' : '';
  return `${marker}${name}: ${profile.type ?? 'unknown'} ${profile.model ?? '(no model)'}`;
}

export async function buildProviderSwitch(
  providers: Record<string, IProviderProfileSettings> | undefined,
  profileName: string | undefined,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
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
  const initial = options.settings.readMergedSettings();
  if (initial.currentProvider === profileName) {
    return { message: `Already using provider "${profileName}".`, success: true };
  }
  const profile = providers[profileName];
  // #3282: the hot-swap this returns as a `hostActions` entry builds this exact profile against
  // these exact definitions (`resolveUserSettingsProviderSwitch` in agent-framework). Validating it
  // HERE, before anything is written, means a switch that would fail changes nothing on disk — the
  // previous behavior wrote `currentProvider` unconditionally and let a downstream hot-swap failure
  // (e.g. "Unknown provider: anthropic. Currently supported: ", an empty list) stand uncorrected.
  try {
    await validateProviderConnection(profileName, profile, options);
  } catch (error) {
    return {
      message: `Failed to switch to "${profileName}": ${error instanceof Error ? error.message : String(error)}`,
      success: false,
    };
  }
  const target = options.settings.readTargetSettings();
  const merged = options.settings.readMergedSettings();
  if (
    merged.currentProvider !== initial.currentProvider ||
    JSON.stringify(merged.providers?.[profileName]) !== JSON.stringify(profile)
  ) {
    return {
      success: false,
      message: 'Provider settings changed while switching. Run /provider switch again.',
    };
  }
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
      includeEditOnlySteps: true,
      profileName,
      setCurrent: false,
      initialValues: getProviderProfileSetupValues(profile),
    });
    if (hasProviderConnectionMethods(profile.type, options)) {
      flow = { ...flow, steps: flow.steps.filter((step) => step.key !== 'apiKey') };
    }
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

/** Explicitly replace this profile's connection; ordinary editing preserves its credential. */
export async function buildProviderReconnect(
  ui: IUserInteraction,
  profileName: string,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  const profile = options.settings.readMergedSettings().providers?.[profileName];
  if (!profile?.type)
    return { success: false, message: `Provider profile "${profileName}" was not found.` };
  if (!hasProviderConnectionMethods(profile.type, options)) {
    return {
      success: false,
      message: `Use /provider edit ${profileName} to update this provider's credentials.`,
    };
  }
  const flow = createProviderSetupFlow(profile.type, options.providerDefinitions, {
    profileName,
    setCurrent: false,
    initialValues: { ...(profile.model === undefined ? {} : { model: profile.model }) },
  });
  return runProviderConnectionSetup(ui, flow, options, false, true);
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
  const patch = buildProviderSetupPatch(
    {
      ...input,
      ...(input.apiKey === undefined && currentProfile.apiKeyRef !== undefined
        ? { apiKeyRef: currentProfile.apiKeyRef }
        : {}),
      ...(input.apiKey === undefined && currentProfile.apiKey !== undefined
        ? { apiKey: currentProfile.apiKey }
        : {}),
    },
    {
      providerDefinitions: options.providerDefinitions,
      ...(options.env === undefined ? {} : { env: options.env }),
    },
  );
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
