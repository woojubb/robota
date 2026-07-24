import { confirmAction, isConfirmed, selectAction, textAction } from '@robota-sdk/agent-core';
import {
  deleteProviderProfile,
  sanitizeProviderProfileName,
  upsertProviderProfile,
} from '@robota-sdk/agent-framework';

import { formatProviderChoiceLabel } from './provider-command-profile-operations.js';

import type { IUserInteraction } from '@robota-sdk/agent-core';
import type { IProviderCommandModuleOptions } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

const MAX_DUPLICATE_PROFILE_SUFFIX = 1000;
const PROVIDER_RESTART_ACTION = {
  type: 'session-restart',
  reason: 'other',
} as const;

export async function buildProviderDuplicate(
  ui: IUserInteraction,
  profileName: string,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  const settings = options.settings.readMergedSettings();
  if (!settings.providers?.[profileName]) {
    return { message: `Provider profile "${profileName}" was not found.`, success: false };
  }
  const defaultName = suggestDuplicateProfileName(profileName, Object.keys(settings.providers));
  let errorMessage: string | undefined;
  for (;;) {
    const response = await ui.ask(
      textAction('provider-duplicate', `Duplicate ${profileName} as`, {
        description: errorMessage,
        placeholder: defaultName,
        allowEmpty: true,
      }),
    );
    if (response.type === 'cancelled') {
      return { message: 'Provider duplicate cancelled.', success: true };
    }
    const value = response.text ?? '';
    // Re-ask on validation failure, surfacing the reason (CMD-004 re-ask loop replaces the closure).
    const validationMessage = validateDuplicateProfileName(value, defaultName, options);
    if (validationMessage !== undefined) {
      errorMessage = validationMessage;
      continue;
    }
    return completeProviderDuplicate(profileName, value, defaultName, options);
  }
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

export async function buildProviderDelete(
  ui: IUserInteraction,
  profileName: string,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
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
  const response = await ui.ask(
    confirmAction('provider-delete', `Delete provider profile ${profileName}?`),
  );
  if (!isConfirmed(response)) {
    return { message: 'Provider delete cancelled.', success: true };
  }
  return confirmProviderDelete(ui, profileName, options);
}

async function confirmProviderDelete(
  ui: IUserInteraction,
  profileName: string,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
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
  const response = await ui.ask(
    selectAction(
      'provider-delete-replacement',
      `Replacement provider for ${profileName}`,
      replacementOptions,
      {
        maxVisible: 8,
      },
    ),
  );
  if (response.type !== 'answer' || response.values[0] === undefined) {
    return { message: 'Provider delete cancelled.', success: true };
  }
  return completeActiveProviderDelete(profileName, response.values[0], options);
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
    hostActions: [{ ...PROVIDER_RESTART_ACTION, message: 'Provider delete restart' }],
  };
}

function suggestDuplicateProfileName(
  profileName: string,
  existingProfileNames: readonly string[],
): string {
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
