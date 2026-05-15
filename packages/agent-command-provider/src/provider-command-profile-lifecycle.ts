import type {
  ICommandInteraction,
  ICommandResult,
  IProviderCommandModuleOptions,
} from '@robota-sdk/agent-sdk';
import {
  deleteProviderProfile,
  sanitizeProviderProfileName,
  upsertProviderProfile,
} from '@robota-sdk/agent-sdk';
import { formatProviderChoiceLabel } from './provider-command-profile-operations.js';

const YES = 'yes';
const MAX_DUPLICATE_PROFILE_SUFFIX = 1000;
const PROVIDER_RESTART_EFFECT = {
  type: 'session-restart-requested',
  reason: 'other',
} as const;

export function buildProviderDuplicate(
  profileName: string,
  options: IProviderCommandModuleOptions,
): ICommandResult {
  const settings = options.settings.readMergedSettings();
  if (!settings.providers?.[profileName]) {
    return { message: `Provider profile "${profileName}" was not found.`, success: false };
  }
  const defaultName = suggestDuplicateProfileName(profileName, Object.keys(settings.providers));
  return {
    message: `Provider duplicate requested: ${profileName}`,
    success: true,
    interaction: createProviderDuplicateInteraction(profileName, defaultName, options),
  };
}

function createProviderDuplicateInteraction(
  profileName: string,
  defaultName: string,
  options: IProviderCommandModuleOptions,
): ICommandInteraction {
  return {
    prompt: {
      kind: 'text',
      title: `Duplicate ${profileName} as`,
      placeholder: defaultName,
      allowEmpty: true,
      validate: (value) => validateDuplicateProfileName(value, defaultName, options),
    },
    submit: (value) => completeProviderDuplicate(profileName, value, defaultName, options),
    cancel: () => ({ message: 'Provider duplicate cancelled.', success: true }),
  };
}

function validateDuplicateProfileName(
  value: string,
  defaultName: string,
  options: IProviderCommandModuleOptions,
): string | undefined {
  const name = normalizeProfileName(value, defaultName);
  if (name.length === 0) {
    return 'Required';
  }
  if (options.settings.readMergedSettings().providers?.[name] !== undefined) {
    return `Provider profile "${name}" already exists`;
  }
  return undefined;
}

function completeProviderDuplicate(
  profileName: string,
  value: string,
  defaultName: string,
  options: IProviderCommandModuleOptions,
): ICommandResult {
  const settings = options.settings.readMergedSettings();
  const sourceProfile = settings.providers?.[profileName];
  if (!sourceProfile) {
    return { message: `Provider profile "${profileName}" was not found.`, success: false };
  }
  const targetName = normalizeProfileName(value, defaultName);
  const validationMessage = validateDuplicateProfileName(targetName, defaultName, options);
  if (validationMessage !== undefined) {
    return { message: validationMessage, success: false };
  }
  options.settings.writeTargetSettings(
    upsertProviderProfile(options.settings.readTargetSettings(), targetName, { ...sourceProfile }),
  );
  return {
    message: `Provider profile duplicated: ${profileName} -> ${targetName}.`,
    success: true,
  };
}

export function buildProviderDelete(
  profileName: string,
  options: IProviderCommandModuleOptions,
): ICommandResult {
  const settings = options.settings.readMergedSettings();
  const providers = settings.providers ?? {};
  if (!providers[profileName]) {
    return { message: `Provider profile "${profileName}" was not found.`, success: false };
  }
  if (Object.keys(providers).length <= 1) {
    return { message: 'Cannot delete the only provider profile.', success: false };
  }
  if (options.settings.readTargetSettings().providers?.[profileName] === undefined) {
    return {
      message: `Provider profile "${profileName}" is not stored in the active write target; edit its source settings file or override it before deleting.`,
      success: false,
    };
  }
  return {
    message: `Provider delete requested: ${profileName}`,
    success: true,
    interaction: createProviderDeleteConfirmationInteraction(profileName, options),
  };
}

function createProviderDeleteConfirmationInteraction(
  profileName: string,
  options: IProviderCommandModuleOptions,
): ICommandInteraction {
  return {
    prompt: {
      kind: 'choice',
      title: `Delete provider profile ${profileName}?`,
      options: [
        { value: YES, label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    },
    submit: (value) => {
      if (value !== YES) {
        return { message: 'Provider delete cancelled.', success: true };
      }
      return confirmProviderDelete(profileName, options);
    },
    cancel: () => ({ message: 'Provider delete cancelled.', success: true }),
  };
}

function confirmProviderDelete(
  profileName: string,
  options: IProviderCommandModuleOptions,
): ICommandResult {
  const settings = options.settings.readMergedSettings();
  if (settings.currentProvider !== profileName) {
    options.settings.writeTargetSettings(
      deleteProviderProfile(options.settings.readTargetSettings(), profileName),
    );
    return { message: `Provider profile deleted: ${profileName}.`, success: true };
  }
  const replacementOptions = Object.entries(settings.providers ?? {})
    .filter(([name]) => name !== profileName)
    .map(([name, profile]) => ({
      value: name,
      label: formatProviderChoiceLabel(name, profile, settings.currentProvider),
    }));
  return {
    message: `Select a replacement provider before deleting ${profileName}.`,
    success: true,
    interaction: {
      prompt: {
        kind: 'choice',
        title: `Replacement provider for ${profileName}`,
        options: replacementOptions,
        maxVisible: 8,
      },
      submit: (replacementName) =>
        completeActiveProviderDelete(profileName, replacementName, options),
      cancel: () => ({ message: 'Provider delete cancelled.', success: true }),
    },
  };
}

function completeActiveProviderDelete(
  profileName: string,
  replacementName: string,
  options: IProviderCommandModuleOptions,
): ICommandResult {
  const settings = options.settings.readMergedSettings();
  if (settings.providers?.[replacementName] === undefined || replacementName === profileName) {
    return { message: `Provider profile "${replacementName}" was not found.`, success: false };
  }
  const target = deleteProviderProfile(options.settings.readTargetSettings(), profileName);
  options.settings.writeTargetSettings({ ...target, currentProvider: replacementName });
  return {
    message: `Provider profile deleted: ${profileName}. Restarting with ${replacementName}...`,
    success: true,
    effects: [{ ...PROVIDER_RESTART_EFFECT, message: 'Provider delete restart' }],
  };
}

function suggestDuplicateProfileName(profileName: string, existingProfileNames: readonly string[]) {
  const base = sanitizeProviderProfileName(`${profileName}-copy`) ?? 'provider-copy';
  if (!existingProfileNames.includes(base)) {
    return base;
  }
  for (let index = 2; index < MAX_DUPLICATE_PROFILE_SUFFIX; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existingProfileNames.includes(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
}

function normalizeProfileName(value: string, defaultName: string): string {
  const raw = value.trim() || defaultName;
  return sanitizeProviderProfileName(raw) ?? '';
}
