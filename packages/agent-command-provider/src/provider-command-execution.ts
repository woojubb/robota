import { findProviderDefinition, formatSupportedProviderTypes } from '@robota-sdk/agent-core';
import type {
  ICommandInteraction,
  ICommandResult,
  IProviderCommandModuleOptions,
  IProviderProfileSettings,
  IProviderSetupInput,
  TCommandInteractionPrompt,
} from '@robota-sdk/agent-sdk';
import {
  buildProviderSetupPatch,
  deleteProviderProfile,
  mergeProviderPatch,
  sanitizeProviderProfileName,
  setCurrentProvider,
  upsertProviderProfile,
  testProviderProfileCommand,
} from '@robota-sdk/agent-sdk';
import type { IProviderSetupFlowState } from './provider-setup-flow.js';
import {
  createProviderSetupFlow,
  formatProviderSetupChoiceLabel,
  formatProviderSetupHelpLinks,
  getProviderSetupStep,
  submitProviderSetupValue,
  validateProviderSetupValue,
} from './provider-setup-flow.js';

const YES = 'yes';
const ACTION_SWITCH = 'switch';
const ACTION_EDIT = 'edit';
const ACTION_TEST = 'test';
const ACTION_DUPLICATE = 'duplicate';
const ACTION_DELETE = 'delete';
const ACTION_CANCEL = 'cancel';
const MAX_DUPLICATE_PROFILE_SUFFIX = 1000;
const PROVIDER_RESTART_EFFECT = {
  type: 'session-restart-requested',
  reason: 'other',
} as const;

export async function executeProviderCommand(
  args: string,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  const settings = options.settings.readMergedSettings();
  const trimmedArgs = args.trim();
  if (trimmedArgs.length === 0) {
    return buildProviderProfilePicker(settings.currentProvider, settings.providers, options);
  }
  const [subcommand = 'current', profileArg] = trimmedArgs.split(/\s+/);

  if (subcommand === 'list') {
    return buildProviderProfilePicker(settings.currentProvider, settings.providers, options);
  }
  if (subcommand === 'current' || subcommand === '') {
    return {
      message: formatCurrentProvider(settings.currentProvider, settings.providers),
      success: true,
    };
  }
  if (subcommand === 'use') {
    return buildProviderSwitch(settings.providers, profileArg, options);
  }
  if (subcommand === 'test') {
    return await testProviderProfileCommand(
      settings.currentProvider,
      settings.providers,
      profileArg,
      options,
    );
  }
  if (subcommand === 'add') {
    return buildProviderSetup(profileArg, options);
  }

  return {
    message: 'Usage: provider [current|list|use <profile>|add <type>|test [profile]]',
    success: false,
  };
}

function buildProviderProfilePicker(
  currentProvider: string | undefined,
  providers: Record<string, IProviderProfileSettings> | undefined,
  options: IProviderCommandModuleOptions,
): ICommandResult {
  const message = formatProviderList(currentProvider, providers);
  if (Object.keys(providers ?? {}).length === 0) {
    return { message, success: true };
  }
  return {
    message,
    success: true,
    interaction: createProviderProfileSelectionInteraction(currentProvider, providers, options),
  };
}

function formatProviderList(
  currentProvider: string | undefined,
  providers: Record<string, IProviderProfileSettings> | undefined,
): string {
  const entries = Object.entries(providers ?? {});
  if (entries.length === 0) {
    return 'No provider profiles configured.';
  }
  return entries
    .map(([name, profile]) => {
      const marker = name === currentProvider ? '*' : '-';
      return `${marker} ${name}: ${profile.type ?? 'unknown'} ${profile.model ?? '(no model)'}`;
    })
    .join('\n');
}

function formatCurrentProvider(
  currentProvider: string | undefined,
  providers: Record<string, IProviderProfileSettings> | undefined,
): string {
  if (!currentProvider) {
    return 'No current provider configured.';
  }
  const profile = providers?.[currentProvider];
  if (!profile) {
    return `Current provider "${currentProvider}" was not found in providers.`;
  }
  return [
    `Current provider: ${currentProvider}`,
    `Type: ${profile.type ?? 'unknown'}`,
    `Model: ${profile.model ?? '(no model)'}`,
    ...(profile.baseURL ? [`Base URL: ${profile.baseURL}`] : []),
  ].join('\n');
}

function buildProviderSwitch(
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

function buildProviderSetup(
  type: string | undefined,
  options: IProviderCommandModuleOptions,
): ICommandResult {
  if (type === undefined || type.length === 0) {
    return {
      message: 'Provider setup requested. Select a provider to continue.',
      success: true,
      interaction: createProviderSelectionInteraction(options),
    };
  }
  if (findProviderDefinition(options.providerDefinitions, type) === undefined) {
    return {
      message: `Usage: provider add <type>. Supported: ${formatSupportedProviderTypes(options.providerDefinitions)}`,
      success: false,
    };
  }
  return {
    message: `Provider setup requested: ${type}`,
    success: true,
    interaction: createProviderSetupInteraction(createSetupFlow(type, options), options),
  };
}

function createProviderSelectionInteraction(
  options: IProviderCommandModuleOptions,
): ICommandInteraction {
  return {
    prompt: {
      kind: 'choice',
      title: 'Select provider',
      options: options.providerDefinitions.map((definition) => ({
        value: definition.type,
        label: formatProviderSetupChoiceLabel(definition),
      })),
      maxVisible: 6,
    },
    submit: (value) => {
      const flow = createSetupFlow(value, options);
      return {
        message: `Provider setup requested: ${value}`,
        success: true,
        interaction: createProviderSetupInteraction(flow, options),
      };
    },
    cancel: () => ({ message: 'Provider setup cancelled.', success: true }),
  };
}

function createSetupFlow(
  type: string,
  options: IProviderCommandModuleOptions,
): IProviderSetupFlowState {
  return createProviderSetupFlow(type, options.providerDefinitions, {
    existingProfileNames: Object.keys(options.settings.readMergedSettings().providers ?? {}),
  });
}

function createProviderSetupInteraction(
  flow: IProviderSetupFlowState,
  options: IProviderCommandModuleOptions,
): ICommandInteraction {
  return {
    prompt: toProviderSetupStepPrompt(flow),
    submit: (value) => submitProviderSetupInteractionValue(flow, value, options),
    cancel: () => ({ message: 'Provider setup cancelled.', success: true }),
  };
}

function submitProviderSetupInteractionValue(
  flow: IProviderSetupFlowState,
  value: string,
  options: IProviderCommandModuleOptions,
): ICommandResult {
  const result = submitProviderSetupValue(flow, value);
  if (result.status === 'error') {
    return {
      message: result.message,
      success: false,
      interaction: createProviderSetupInteraction(flow, options),
    };
  }
  if (result.status === 'complete') {
    return completeProviderSetup(result.input, options);
  }
  return {
    message: '',
    success: true,
    interaction: createProviderSetupInteraction(result.state, options),
  };
}

function toProviderSetupStepPrompt(flow: IProviderSetupFlowState): TCommandInteractionPrompt {
  const step = getProviderSetupStep(flow);
  const placeholder =
    step.masked === true && step.defaultValue !== undefined ? '(unchanged)' : step.defaultValue;
  return {
    kind: 'text',
    title: step.title,
    ...toProviderSetupPromptDescription(flow),
    ...(placeholder !== undefined ? { placeholder } : {}),
    ...(step.defaultValue !== undefined ? { allowEmpty: true } : {}),
    ...(step.masked !== undefined ? { masked: step.masked } : {}),
    validate: (value) => validateProviderSetupValue(step, value),
  };
}

function toProviderSetupPromptDescription(
  flow: IProviderSetupFlowState,
): { description: string } | Record<string, never> {
  const description = formatProviderSetupHelpLinks(flow.setupHelpLinks);
  return description.length > 0 ? { description } : {};
}

function completeProviderSetup(
  input: IProviderSetupInput,
  options: IProviderCommandModuleOptions,
): ICommandResult {
  const target = options.settings.readTargetSettings();
  const patch = buildProviderSetupPatch(input, {
    providerDefinitions: options.providerDefinitions,
  });
  options.settings.writeTargetSettings(mergeProviderPatch(target, patch));
  return {
    message: `Provider ${input.profile} configured. Restarting...`,
    success: true,
    effects: [{ ...PROVIDER_RESTART_EFFECT, message: 'Provider setup restart' }],
  };
}

function createProviderProfileSelectionInteraction(
  currentProvider: string | undefined,
  providers: Record<string, IProviderProfileSettings> | undefined,
  options: IProviderCommandModuleOptions,
): ICommandInteraction {
  return {
    prompt: {
      kind: 'choice',
      title: 'Select provider profile',
      options: Object.entries(providers ?? {}).map(([name, profile]) => ({
        value: name,
        label: formatProviderChoiceLabel(name, profile, currentProvider),
      })),
      maxVisible: 8,
    },
    submit: (value) => buildProviderProfileActionMenu(value, options),
    cancel: () => ({ message: 'Provider profile selection cancelled.', success: true }),
  };
}

function formatProviderChoiceLabel(
  name: string,
  profile: IProviderProfileSettings,
  currentProvider: string | undefined,
): string {
  const marker = name === currentProvider ? '* ' : '';
  return `${marker}${name}: ${profile.type ?? 'unknown'} ${profile.model ?? '(no model)'}`;
}

function buildProviderProfileActionMenu(
  profileName: string,
  options: IProviderCommandModuleOptions,
): ICommandResult {
  const settings = options.settings.readMergedSettings();
  if (!settings.providers?.[profileName]) {
    return { message: `Provider profile "${profileName}" was not found.`, success: false };
  }
  return {
    message: `Provider profile selected: ${profileName}`,
    success: true,
    interaction: createProviderProfileActionInteraction(profileName, options),
  };
}

function createProviderProfileActionInteraction(
  profileName: string,
  options: IProviderCommandModuleOptions,
): ICommandInteraction {
  return {
    prompt: {
      kind: 'choice',
      title: `Provider profile: ${profileName}`,
      options: [
        { value: ACTION_SWITCH, label: 'Switch' },
        { value: ACTION_EDIT, label: 'Edit' },
        { value: ACTION_TEST, label: 'Test' },
        { value: ACTION_DUPLICATE, label: 'Duplicate' },
        { value: ACTION_DELETE, label: 'Delete' },
        { value: ACTION_CANCEL, label: 'Cancel' },
      ],
    },
    submit: (value) => executeProviderProfileAction(profileName, value, options),
    cancel: () => ({ message: 'Provider profile action cancelled.', success: true }),
  };
}

async function executeProviderProfileAction(
  profileName: string,
  action: string,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  const settings = options.settings.readMergedSettings();
  switch (action) {
    case ACTION_SWITCH:
      return buildProviderSwitch(settings.providers, profileName, options);
    case ACTION_EDIT:
      return buildProviderEdit(profileName, options);
    case ACTION_TEST:
      return await testProviderProfileCommand(
        settings.currentProvider,
        settings.providers,
        profileName,
        options,
      );
    case ACTION_DUPLICATE:
      return buildProviderDuplicate(profileName, options);
    case ACTION_DELETE:
      return buildProviderDelete(profileName, options);
    case ACTION_CANCEL:
      return { message: 'Provider profile action cancelled.', success: true };
    default:
      return { message: `Unknown provider profile action "${action}".`, success: false };
  }
}

function buildProviderEdit(
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

function createProviderEditInteraction(
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

function buildProviderDuplicate(
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
  const profileName = normalizeProfileName(value, defaultName);
  if (profileName.length === 0) {
    return 'Required';
  }
  if (options.settings.readMergedSettings().providers?.[profileName] !== undefined) {
    return `Provider profile "${profileName}" already exists`;
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

function buildProviderDelete(
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
