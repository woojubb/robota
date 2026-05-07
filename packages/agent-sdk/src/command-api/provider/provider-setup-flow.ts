import type {
  IProviderDefinition,
  IProviderSetupHelpLink,
  IProviderSetupStepDefinition,
  TProviderSetupField,
} from '@robota-sdk/agent-core';
import { findProviderDefinition, formatSupportedProviderTypes } from '@robota-sdk/agent-core';
import type { IProviderSetupInput } from './provider-settings.js';
import { suggestProviderProfileName } from './provider-profile-names.js';

export type TProviderSetupType = string;
export type TPromptInput = (label: string, masked?: boolean) => Promise<string>;

export interface IProviderSetupPromptStep extends IProviderSetupStepDefinition {
  key: TProviderSetupField;
}

export interface IProviderSetupFlowState {
  type: TProviderSetupType;
  steps: readonly IProviderSetupPromptStep[];
  setupHelpLinks: readonly IProviderSetupHelpLink[];
  stepIndex: number;
  values: Partial<Record<TProviderSetupField, string>>;
  existingProfileNames: readonly string[];
  profileName?: string;
  setCurrent?: boolean;
}

export interface IProviderSetupFlowOptions {
  existingProfileNames?: readonly string[];
  initialValues?: Partial<Record<TProviderSetupField, string>>;
  profileName?: string;
  setCurrent?: boolean;
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
  options: IProviderSetupFlowOptions = {},
): IProviderSetupFlowState {
  const definition = getProviderSetupDefinition(type, providerDefinitions);
  return {
    type,
    steps: applyProviderSetupInitialValues(
      getProviderSetupSteps(definition),
      options.initialValues,
    ),
    setupHelpLinks: definition.setupHelpLinks ?? [],
    stepIndex: 0,
    values: {},
    existingProfileNames: options.existingProfileNames ?? [],
    ...(options.profileName !== undefined ? { profileName: options.profileName } : {}),
    ...(options.setCurrent !== undefined ? { setCurrent: options.setCurrent } : {}),
  };
}

export function formatProviderSetupSelectionPrompt(
  providerDefinitions: readonly IProviderDefinition[],
): string {
  if (providerDefinitions.length === 0) {
    return '  No providers are available.';
  }
  const lines = [
    '  Select provider:',
    ...providerDefinitions.map(
      (definition, index) => `    ${index + 1}. ${formatProviderSetupChoiceLabel(definition)}`,
    ),
    `  Provider [1-${providerDefinitions.length}] (default: 1): `,
  ];
  return lines.join('\n');
}

export function resolveProviderSetupSelection(
  rawValue: string,
  providerDefinitions: readonly IProviderDefinition[],
): TProviderSetupType {
  const value = rawValue.trim();
  const selectedValue = value.length > 0 ? value : '1';
  const index = parseProviderSelectionIndex(selectedValue);
  if (index !== undefined) {
    const definition = providerDefinitions[index];
    if (definition !== undefined) {
      return definition.type;
    }
    throw new Error(
      `Provider selection ${selectedValue} is out of range. Currently supported: ${formatSupportedProviderTypes(providerDefinitions)}`,
    );
  }
  const definition = findProviderDefinition(providerDefinitions, selectedValue);
  if (definition === undefined) {
    throw new Error(
      `Unknown provider: ${selectedValue}. Currently supported: ${formatSupportedProviderTypes(providerDefinitions)}`,
    );
  }
  return definition.type;
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
  options: IProviderSetupFlowOptions = {},
): Promise<IProviderSetupInput> {
  let state = createProviderSetupFlow(type, providerDefinitions, options);
  const stepCount = state.steps.length;
  while (state.stepIndex < stepCount) {
    const step = getProviderSetupStep(state);
    const value = await promptInput(
      formatProviderSetupPromptLabel(step, state.setupHelpLinks),
      step.masked === true,
    );
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

export function formatProviderSetupPromptLabel(
  step: IProviderSetupPromptStep,
  setupHelpLinks: readonly IProviderSetupHelpLink[] = [],
): string {
  const suffix = step.defaultValue !== undefined ? ` (default: ${step.defaultValue})` : '';
  const setupHelp = formatProviderSetupHelpLinks(setupHelpLinks);
  const prefix = setupHelp.length > 0 ? `${setupHelp}\n` : '';
  return `${prefix}  ${step.title}${suffix}: `;
}

export function formatProviderSetupChoiceLabel(definition: IProviderDefinition): string {
  const label =
    definition.displayName !== undefined
      ? `${definition.displayName} (${definition.type})`
      : definition.type;
  return definition.description !== undefined ? `${label} - ${definition.description}` : label;
}

export function formatProviderSetupHelpLinks(
  setupHelpLinks: readonly IProviderSetupHelpLink[] = [],
): string {
  if (setupHelpLinks.length === 0) {
    return '';
  }
  return setupHelpLinks
    .map(
      (link) =>
        `  Setup help: ${formatProviderSetupHelpLinkKind(link.kind)}: ${link.label} - ${link.url}`,
    )
    .join('\n');
}

function parseProviderSelectionIndex(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  return Number(value) - 1;
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

function getProviderSetupDefinition(
  type: TProviderSetupType,
  providerDefinitions: readonly IProviderDefinition[],
): IProviderDefinition {
  const definition = findProviderDefinition(providerDefinitions, type);
  if (definition === undefined) {
    throw new Error(
      `Unknown provider: ${type}. Currently supported: ${formatSupportedProviderTypes(providerDefinitions)}`,
    );
  }
  return definition;
}

function getProviderSetupSteps(definition: IProviderDefinition): IProviderSetupPromptStep[] {
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

function formatProviderSetupHelpLinkKind(kind: IProviderSetupHelpLink['kind']): string {
  if (kind === 'api-key') {
    return 'API key';
  }
  if (kind === 'console') {
    return 'Console';
  }
  return 'Official';
}

function applyProviderSetupInitialValues(
  steps: readonly IProviderSetupPromptStep[],
  initialValues: Partial<Record<TProviderSetupField, string>> | undefined,
): IProviderSetupPromptStep[] {
  if (initialValues === undefined) {
    return [...steps];
  }
  return steps.map((step) => {
    const initialValue = initialValues[step.key];
    if (initialValue === undefined) {
      return step;
    }
    return {
      ...step,
      defaultValue: initialValue,
      required: false,
    };
  });
}

function buildProviderSetupInput(state: IProviderSetupFlowState): IProviderSetupInput {
  const profile =
    state.profileName ??
    suggestProviderProfileName(
      { type: state.type, model: state.values.model },
      { existingProfileNames: state.existingProfileNames },
    );
  const apiKey = state.values.apiKey;
  return {
    profile,
    type: state.type,
    model: state.values.model,
    ...(apiKey !== undefined && apiKey.length > 0 && { apiKey }),
    ...(state.values.baseURL !== undefined && { baseURL: state.values.baseURL }),
    setCurrent: state.setCurrent ?? true,
  };
}
