import { findProviderDefinition, formatSupportedProviderTypes } from '@robota-sdk/agent-core';
import type {
  ICommandInteraction,
  ICommandResult,
  IProviderCommandModuleOptions,
  IProviderProfileSettings,
  IProviderSetupFlowState,
  IProviderSetupInput,
  TCommandInteractionPrompt,
} from '@robota-sdk/agent-sdk';
import {
  buildProviderSetupPatch,
  createProviderSetupFlow,
  formatProviderSetupChoiceLabel,
  getProviderSetupStep,
  mergeProviderPatch,
  setCurrentProvider,
  submitProviderSetupValue,
  testProviderProfileCommand,
  validateProviderSetupValue,
} from '@robota-sdk/agent-sdk';

const YES = 'yes';
const PROVIDER_RESTART_EFFECT = {
  type: 'session-restart-requested',
  reason: 'other',
} as const;

export async function executeProviderCommand(
  args: string,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  const settings = options.settings.readMergedSettings();
  const [subcommand = 'current', profileArg] = args.trim().split(/\s+/);

  if (subcommand === 'list') {
    return {
      message: formatProviderList(settings.currentProvider, settings.providers),
      success: true,
    };
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
  return {
    kind: 'text',
    title: step.title,
    ...(step.defaultValue !== undefined ? { placeholder: step.defaultValue } : {}),
    ...(step.defaultValue !== undefined ? { allowEmpty: true } : {}),
    ...(step.masked !== undefined ? { masked: step.masked } : {}),
    validate: (value) => validateProviderSetupValue(step, value),
  };
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
