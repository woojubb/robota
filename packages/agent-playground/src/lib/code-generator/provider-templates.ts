export interface IProviderTemplate {
  importPath: string;
  className: string;
  envKey: string;
}

const PROVIDER_TEMPLATES: Record<string, IProviderTemplate> = {
  openai: {
    importPath: '@robota-sdk/agent-provider/openai',
    className: 'OpenAIProvider',
    envKey: 'OPENAI_API_KEY',
  },
  anthropic: {
    importPath: '@robota-sdk/agent-provider/anthropic',
    className: 'AnthropicProvider',
    envKey: 'ANTHROPIC_API_KEY',
  },
  gemini: {
    importPath: '@robota-sdk/agent-provider/gemini',
    className: 'GeminiProvider',
    envKey: 'GEMINI_API_KEY',
  },
  deepseek: {
    importPath: '@robota-sdk/agent-provider/deepseek',
    className: 'DeepSeekProvider',
    envKey: 'DEEPSEEK_API_KEY',
  },
};

export function getProviderTemplate(provider: string): IProviderTemplate {
  return (
    PROVIDER_TEMPLATES[provider.toLowerCase()] ?? {
      importPath: `@robota-sdk/agent-provider/${provider.toLowerCase()}`,
      className: `${provider.charAt(0).toUpperCase()}${provider.slice(1)}Provider`,
      envKey: `${provider.toUpperCase()}_API_KEY`,
    }
  );
}
