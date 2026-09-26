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
  deepseek: {
    importPath: PROVIDER_PACKAGES.openaiCompatible,
    className: 'DeepSeekProvider',
    envKey: 'DEEPSEEK_API_KEY',
  },
};

export function getProviderTemplate(provider: string): IProviderTemplate {
  return (
    PROVIDER_TEMPLATES[provider.toLowerCase()] ?? {
      importPath: `@robota-sdk/agent-provider-${provider.toLowerCase()}`,
      className: `${provider.charAt(0).toUpperCase()}${provider.slice(1)}Provider`,
      envKey: `${provider.toUpperCase()}_API_KEY`,
    }
  );
}
