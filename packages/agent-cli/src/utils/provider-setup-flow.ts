import type { IProviderSetupInput } from './provider-settings.js';
import {
  DEFAULT_OPENAI_COMPATIBLE_API_KEY,
  DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
  DEFAULT_PROVIDER_MODELS,
} from './provider-settings.js';

export type TProviderSetupType = 'openai' | 'anthropic';
export type TProviderSetupField = 'baseURL' | 'model' | 'apiKey';
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

export function createProviderSetupFlow(type: TProviderSetupType): IProviderSetupFlowState {
  return { type, stepIndex: 0, values: {} };
}

export function getProviderSetupStep(state: IProviderSetupFlowState): IProviderSetupPromptStep {
  const step = getProviderSetupSteps(state.type)[state.stepIndex];
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
  if (nextState.stepIndex < getProviderSetupSteps(state.type).length) {
    return { status: 'next', state: nextState };
  }
  return { status: 'complete', input: buildProviderSetupInput(nextState) };
}

export async function runProviderSetupPromptFlow(
  type: TProviderSetupType,
  promptInput: TPromptInput,
): Promise<IProviderSetupInput> {
  let state = createProviderSetupFlow(type);
  const stepCount = getProviderSetupSteps(type).length;
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

function getProviderSetupSteps(type: TProviderSetupType): IProviderSetupPromptStep[] {
  if (type === 'openai') {
    return [
      {
        key: 'baseURL',
        title: 'OpenAI-compatible base URL',
        defaultValue: DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
      },
      {
        key: 'model',
        title: 'OpenAI-compatible model',
        defaultValue: DEFAULT_PROVIDER_MODELS.openai,
      },
      {
        key: 'apiKey',
        title: 'OpenAI-compatible API key',
        defaultValue: DEFAULT_OPENAI_COMPATIBLE_API_KEY,
        masked: true,
      },
    ];
  }
  return [
    { key: 'apiKey', title: 'Anthropic API key', required: true, masked: true },
    { key: 'model', title: 'Anthropic model', defaultValue: DEFAULT_PROVIDER_MODELS.anthropic },
  ];
}

function buildProviderSetupInput(state: IProviderSetupFlowState): IProviderSetupInput {
  return {
    profile: state.type,
    type: state.type,
    model: state.values.model,
    apiKey: state.values.apiKey,
    ...(state.type === 'openai' && { baseURL: state.values.baseURL }),
    setCurrent: true,
  };
}
