import type {
  ICommandInteraction,
  ICommandResult,
  IProviderCommandModuleOptions,
  IProviderSetupInput,
  TCommandInteractionPrompt,
} from '@robota-sdk/agent-sdk';
import { buildProviderSetupPatch, mergeProviderPatch } from '@robota-sdk/agent-sdk';
import type { IProviderSetupFlowState } from './provider-setup-flow.js';
import {
  createProviderSetupFlow,
  formatProviderSetupHelpLinks,
  getProviderSetupStep,
  submitProviderSetupValue,
  validateProviderSetupValue,
} from './provider-setup-flow.js';

const PROVIDER_RESTART_EFFECT = {
  type: 'session-restart-requested',
  reason: 'other',
} as const;

export function createSetupFlow(
  type: string,
  options: IProviderCommandModuleOptions,
): IProviderSetupFlowState {
  return createProviderSetupFlow(type, options.providerDefinitions, {
    existingProfileNames: Object.keys(options.settings.readMergedSettings().providers ?? {}),
  });
}

export function createProviderSetupInteraction(
  flow: IProviderSetupFlowState,
  options: IProviderCommandModuleOptions,
): ICommandInteraction {
  return {
    prompt: toProviderSetupStepPrompt(flow),
    submit: (value) => submitProviderSetupInteractionValue(flow, value, options),
    cancel: () => ({ message: 'Provider setup cancelled.', success: true }),
  };
}

export function toProviderSetupStepPrompt(
  flow: IProviderSetupFlowState,
): TCommandInteractionPrompt {
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

export function toProviderSetupPromptDescription(
  flow: IProviderSetupFlowState,
): { description: string } | Record<string, never> {
  const description = formatProviderSetupHelpLinks(flow.setupHelpLinks);
  return description.length > 0 ? { description } : {};
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

export function completeProviderSetup(
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
