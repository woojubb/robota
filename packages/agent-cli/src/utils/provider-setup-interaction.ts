import type { IProviderSetupInput } from './provider-settings.js';
import type { IProviderDefinition } from './provider-definition.js';
import {
  createProviderSetupFlow,
  formatProviderSetupChoiceLabel,
  getProviderSetupStep,
  submitProviderSetupValue,
  validateProviderSetupValue,
  type IProviderSetupFlowState,
  type TProviderSetupType,
} from './provider-setup-flow.js';
import type { TInteractivePrompt } from './interactive-prompt.js';

export type TProviderSetupInteractionState =
  | {
      mode: 'select-provider';
      providerDefinitions: readonly IProviderDefinition[];
    }
  | {
      mode: 'setup-fields';
      providerDefinitions: readonly IProviderDefinition[];
      flow: IProviderSetupFlowState;
    };

export type TProviderSetupInteractionResult =
  | {
      status: 'prompt';
      state: TProviderSetupInteractionState;
      prompt: TInteractivePrompt;
    }
  | {
      status: 'complete';
      input: IProviderSetupInput;
    };

export function startProviderSetupInteraction(
  providerDefinitions: readonly IProviderDefinition[],
  type?: TProviderSetupType,
): TProviderSetupInteractionResult {
  if (type === undefined) {
    const state: TProviderSetupInteractionState = {
      mode: 'select-provider',
      providerDefinitions,
    };
    return { status: 'prompt', state, prompt: toProviderSelectionPrompt(providerDefinitions) };
  }

  const state: TProviderSetupInteractionState = {
    mode: 'setup-fields',
    providerDefinitions,
    flow: createProviderSetupFlow(type, providerDefinitions),
  };
  return { status: 'prompt', state, prompt: toProviderSetupStepPrompt(state.flow) };
}

export function submitProviderSetupInteractionValue(
  state: TProviderSetupInteractionState,
  value: string,
): TProviderSetupInteractionResult {
  if (state.mode === 'select-provider') {
    const nextState: TProviderSetupInteractionState = {
      mode: 'setup-fields',
      providerDefinitions: state.providerDefinitions,
      flow: createProviderSetupFlow(value, state.providerDefinitions),
    };
    return {
      status: 'prompt',
      state: nextState,
      prompt: toProviderSetupStepPrompt(nextState.flow),
    };
  }

  const result = submitProviderSetupValue(state.flow, value);
  if (result.status === 'complete') {
    return { status: 'complete', input: result.input };
  }

  const nextState: TProviderSetupInteractionState = {
    ...state,
    flow: result.state,
  };
  return { status: 'prompt', state: nextState, prompt: toProviderSetupStepPrompt(result.state) };
}

function toProviderSelectionPrompt(
  providerDefinitions: readonly IProviderDefinition[],
): TInteractivePrompt {
  return {
    kind: 'choice',
    title: 'Select provider',
    options: providerDefinitions.map((definition) => ({
      value: definition.type,
      label: formatProviderSetupChoiceLabel(definition),
    })),
    maxVisible: 6,
  };
}

function toProviderSetupStepPrompt(flow: IProviderSetupFlowState): TInteractivePrompt {
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
