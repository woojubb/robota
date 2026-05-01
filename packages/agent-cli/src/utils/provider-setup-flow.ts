import type { IProviderSetupInput } from './provider-settings.js';
import {
  findProviderDefinition,
  formatSupportedProviderTypes,
  type IProviderDefinition,
  type TProviderSetupField,
} from './provider-definition.js';

export type TProviderSetupType = string;
export type TPromptInput = (label: string, masked?: boolean) => Promise<string>;

export interface IProviderSetupPromptStep {
  key: TProviderSetupField;
  title: string;
  defaultValue?: string;
  required?: boolean;
  masked?: boolean;
}

export interface IProviderSetupFlowState {
  type: TProviderSetupType;
  steps: readonly IProviderSetupPromptStep[];
  stepIndex: number;
  values: Partial<Record<TProviderSetupField, string>>;
}

export type TProviderSetupFlowSubmitResult =
  | {
      status: 'next';
      state: IProviderSetupFlowState;
    }
  | {
      status: 'complete';
      input: IProviderSetupInput;
    }
  | {
      status: 'error';
      state: IProviderSetupFlowState;
      message: string;
    };

export function createProviderSetupFlow(
  type: TProviderSetupType,
  providerDefinitions: readonly IProviderDefinition[],
): IProviderSetupFlowState {
  return {
    type,
    steps: getProviderSetupSteps(type, providerDefinitions),
    stepIndex: 0,
    values: {},
  };
}

export function getProviderSetupStep(state: IProviderSetupFlowState): IProviderSetupPromptStep {
  const step = state.steps[state.stepIndex];
  if (step === undefined) {
    throw new Error(`Provider setup step ${state.stepIndex} is out of range`);
  }
  return step;
}

export function submitProviderSetupValue(
  state: IProviderSetupFlowState,
  rawValue: string,
): TProviderSetupFlowSubmitResult {
  const step = getProviderSetupStep(state);
  const value = rawValue.trim() || step.defaultValue || '';
  const validationMessage = validateProviderSetupValue(step, value);
  if (validationMessage !== undefined) {
    return { status: 'error', state, message: validationMessage };
  }

  const nextState = {
    ...state,
    stepIndex: state.stepIndex + 1,
    values: { ...state.values, [step.key]: value },
  };
  if (nextState.stepIndex < state.steps.length) {
    return { status: 'next', state: nextState };
  }
  return { status: 'complete', input: buildProviderSetupInput(nextState) };
}

export async function runProviderSetupPromptFlow(
  type: TProviderSetupType,
  promptInput: TPromptInput,
  providerDefinitions: readonly IProviderDefinition[],
): Promise<IProviderSetupInput> {
  let state = createProviderSetupFlow(type, providerDefinitions);
  const stepCount = state.steps.length;
  while (state.stepIndex < stepCount) {
    const step = getProviderSetupStep(state);
    const value = await promptInput(formatProviderSetupPromptLabel(step), step.masked === true);
    const result = submitProviderSetupValue(state, value);
    if (result.status === 'complete') {
      return result.input;
    }
    if (result.status === 'error') {
      throw new Error(result.message);
    }
    state = result.state;
  }
  throw new Error('Provider setup flow ended without completion');
}

export function formatProviderSetupPromptLabel(step: IProviderSetupPromptStep): string {
  const suffix = step.defaultValue !== undefined ? ` (default: ${step.defaultValue})` : '';
  return `  ${step.title}${suffix}: `;
}

export function validateProviderSetupValue(
  step: IProviderSetupPromptStep,
  value: string,
): string | undefined {
  if (step.required === true && value.length === 0) {
    return 'Required';
  }
  return undefined;
}

function getProviderSetupSteps(
  type: TProviderSetupType,
  providerDefinitions: readonly IProviderDefinition[],
): IProviderSetupPromptStep[] {
  const definition = findProviderDefinition(providerDefinitions, type);
  if (definition === undefined) {
    throw new Error(
      `Unknown provider: ${type}. Currently supported: ${formatSupportedProviderTypes(providerDefinitions)}`,
    );
  }
  if (definition.setupSteps !== undefined) {
    return [...definition.setupSteps];
  }

  const steps: IProviderSetupPromptStep[] = [
    {
      key: 'model',
      title: `${definition.type} model`,
      defaultValue: definition.defaults?.model,
      required: definition.defaults?.model === undefined,
    },
  ];
  if (definition.defaults?.baseURL !== undefined) {
    steps.unshift({
      key: 'baseURL',
      title: `${definition.type} base URL`,
      defaultValue: definition.defaults.baseURL,
    });
  }
  if (definition.requiresApiKey === true) {
    steps.push({
      key: 'apiKey',
      title: `${definition.type} API key`,
      defaultValue: definition.defaults?.apiKey,
      required: definition.defaults?.apiKey === undefined,
      masked: true,
    });
  }
  return steps;
}

function buildProviderSetupInput(state: IProviderSetupFlowState): IProviderSetupInput {
  return {
    profile: state.type,
    type: state.type,
    model: state.values.model,
    apiKey: state.values.apiKey,
    ...(state.values.baseURL !== undefined && { baseURL: state.values.baseURL }),
    setCurrent: true,
  };
}
