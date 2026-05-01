import type { IAIProvider } from './provider';

export interface IProviderConfig {
  name: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
}

export interface IProviderProfileDefaults {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
}

export interface IProviderProfileConfig {
  type?: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
}

export interface IProviderProbeResult {
  ok: boolean;
  message: string;
  models?: string[];
}

export type TProviderSetupField = 'baseURL' | 'model' | 'apiKey';

export interface IProviderSetupStepDefinition {
  key: TProviderSetupField;
  title: string;
  defaultValue?: string;
  required?: boolean;
  masked?: boolean;
}

export interface IProviderDefinition {
  type: string;
  displayName?: string;
  description?: string;
  defaults?: IProviderProfileDefaults;
  setupSteps?: readonly IProviderSetupStepDefinition[];
  requiresApiKey?: boolean;
  createProvider: (config: IProviderConfig) => IAIProvider;
  probeProfile?: (profile: IProviderProfileConfig) => Promise<IProviderProbeResult>;
}

export function findProviderDefinition(
  definitions: readonly IProviderDefinition[],
  type: string,
): IProviderDefinition | undefined {
  return definitions.find((definition) => definition.type === type);
}

export function formatSupportedProviderTypes(definitions: readonly IProviderDefinition[]): string {
  return definitions.map((definition) => definition.type).join(', ');
}
