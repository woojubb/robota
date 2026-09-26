import { PROVIDER_PACKAGES } from '../provider-packages';

export interface IProviderTemplate {
  importPath: string;
  className: string;
  envKey: string;
}

const PROVIDER_TEMPLATES: Record<string, IProviderTemplate> = {
  openai: {
    importPath: PROVIDER_PACKAGES.openai,
    className: 'OpenAIProvider',
    envKey: 'OPENAI_API_KEY',
  },
  anthropic: {
    importPath: PROVIDER_PACKAGES.anthropic,
    className: 'AnthropicProvider',
    envKey: 'ANTHROPIC_API_KEY',
  },
  gemini: {
    importPath: PROVIDER_PACKAGES.gemini,
    className: 'GeminiProvider',
    envKey: 'GEMINI_API_KEY',
  },
  google: {
    importPath: PROVIDER_PACKAGES.gemini,
    className: 'GeminiProvider',
    envKey: 'GEMINI_API_KEY',
  },
  deepseek: {
    importPath: PROVIDER_PACKAGES.openaiCompatible,
    className: 'DeepSeekProvider',
    envKey: 'DEEPSEEK_API_KEY',
  },
};

/** The code template for a provider, or `undefined` when code export does not support it. */
export function getProviderTemplate(provider: string): IProviderTemplate | undefined {
  return PROVIDER_TEMPLATES[provider.toLowerCase()];
}

export function isExportableProvider(provider: string): boolean {
  return getProviderTemplate(provider) !== undefined;
}

export function requireProviderTemplate(provider: string): IProviderTemplate {
  const template = getProviderTemplate(provider);
  if (!template) {
    throw new Error(`Code export does not support the "${provider}" provider`);
  }
  return template;
}
