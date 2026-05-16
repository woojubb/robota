import type {
  ICommandInteraction,
  ICommandResult,
  IProviderCommandModuleOptions,
  IProviderProfileSettings,
  IProviderSetupInput,
} from '@robota-sdk/agent-sdk';
import {
  buildProviderSetupPatch,
  setCurrentProvider,
  upsertProviderProfile,
} from '@robota-sdk/agent-sdk';
import { createProviderSetupFlow, submitProviderSetupValue } from './provider-setup-flow.js';
import type { IProviderSetupFlowState } from './provider-setup-flow.js';
import {
  createProviderSetupInteraction,
  toProviderSetupStepPrompt,
} from './provider-command-setup.js';

const YES = 'yes';
const PROVIDER_RESTART_EFFECT = {
  type: 'session-restart-requested',
  reason: 'other',
} as const;

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
    return { message: 'Usage: provider use <profile>', success: false };
  }
  if (!providers?.[profileName]) {
    return { message: `Provider profile "${profileName}" was not found.`, success: false };
  }
  if (options.settings.readMergedSettings().currentProvider === profileName) {
    return { message: `Provider profile "${profileName}" is already current.`, success: true };
  }
  return {
    message: `Provider change requested: ${profileName}`,
    success: true,
    interaction: createProviderSwitchInteraction(profileName, options),
  };
}

function createProviderSwitchInteraction(
  profileName: string,
  options: IProviderCommandModuleOptions,
): ICommandInteraction {
  return {
    prompt: {
      kind: 'choice',
      title: `Change provider to ${profileName}? This will restart the session.`,
      options: [
        { value: YES, label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    },
    submit: (value) => {
      if (value !== YES) {
        return { message: 'Provider change cancelled.', success: true };
      }
      const merged = options.settings.readMergedSettings();
      const target = options.settings.readTargetSettings();
      const next =
        target.providers?.[profileName] !== undefined ||
        merged.providers?.[profileName] !== undefined
          ? { ...target, currentProvider: profileName }
          : setCurrentProvider(target, profileName);
      options.settings.writeTargetSettings(next);
      return {
        message: `Provider changed to ${profileName}. Restarting...`,
        success: true,
        effects: [{ ...PROVIDER_RESTART_EFFECT, message: 'Provider change restart' }],
      };
    },
    cancel: () => ({ message: 'Provider change cancelled.', success: true }),
  };
}

export function buildProviderEdit(
  profileName: string,
  options: IProviderCommandModuleOptions,
): ICommandResult {
  const settings = options.settings.readMergedSettings();
  const profile = settings.providers?.[profileName];
  if (!profile) {
    return { message: `Provider profile "${profileName}" was not found.`, success: false };
  }
  if (!profile.type) {
    return { message: `Provider profile "${profileName}" is missing type.`, success: false };
  }
  try {
    const flow = createProviderSetupFlow(profile.type, options.providerDefinitions, {
      profileName,
      setCurrent: false,
      initialValues: getProviderProfileSetupValues(profile),
    });
    return {
      message: `Provider edit requested: ${profileName}`,
      success: true,
      interaction: createProviderEditInteraction(flow, profileName, options),
    };
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error), success: false };
  }
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

export function createProviderEditInteraction(
  flow: IProviderSetupFlowState,
  profileName: string,
  options: IProviderCommandModuleOptions,
): ICommandInteraction {
  return {
    prompt: toProviderSetupStepPrompt(flow),
    submit: (value) => submitProviderEditInteractionValue(flow, profileName, value, options),
    cancel: () => ({ message: 'Provider edit cancelled.', success: true }),
  };
}

function submitProviderEditInteractionValue(
  flow: IProviderSetupFlowState,
  profileName: string,
  value: string,
  options: IProviderCommandModuleOptions,
): ICommandResult {
  const result = submitProviderSetupValue(flow, value);
  if (result.status === 'error') {
    return {
      message: result.message,
      success: false,
      interaction: createProviderEditInteraction(flow, profileName, options),
    };
  }
  if (result.status === 'complete') {
    return completeProviderEdit(result.input, profileName, options);
  }
  return {
    message: '',
    success: true,
    interaction: createProviderEditInteraction(result.state, profileName, options),
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
      ? `Provider ${profileName} updated. Restarting...`
      : `Provider ${profileName} updated.`,
    success: true,
    ...(isCurrent
      ? { effects: [{ ...PROVIDER_RESTART_EFFECT, message: 'Provider edit restart' }] }
      : {}),
  };
}
