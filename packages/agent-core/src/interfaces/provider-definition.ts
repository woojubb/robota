import type { IAIProvider } from './provider';
import type { TUniversalValue } from './types';

export interface IProviderConfig {
  name: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  options?: Record<string, TUniversalValue>;
}

export interface IProviderProfileDefaults {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  options?: Record<string, TUniversalValue>;
}

export interface IProviderProfileConfig {
  type?: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  options?: Record<string, TUniversalValue>;
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
  aliases?: readonly string[];
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
  return definitions.find(
    (definition) => definition.type === type || definition.aliases?.includes(type) === true,
  );
}

export function formatSupportedProviderTypes(definitions: readonly IProviderDefinition[]): string {
  return definitions
    .map((definition) => {
      if (!definition.aliases || definition.aliases.length === 0) {
        return definition.type;
      }
      const aliasLabel = definition.aliases.length === 1 ? 'alias' : 'aliases';
      return `${definition.type} (${aliasLabel}: ${definition.aliases.join(', ')})`;
    })
    .join(', ');
}
