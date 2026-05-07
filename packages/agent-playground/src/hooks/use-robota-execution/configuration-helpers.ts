import type { IPlaygroundAgentConfig } from '../../lib/playground/robota-executor';

export function getDefaultAgentConfig(): IPlaygroundAgentConfig {
  return {
    name: 'New Agent',
    aiProviders: [],
    defaultModel: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.6,
      maxTokens: 2000,
      systemMessage: '',
    },
    tools: [],
    plugins: [],
  };
}

export function validateConfiguration(config: IPlaygroundAgentConfig): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.name || config.name.trim().length === 0) {
    errors.push('Name is required');
  }

  if (!config.aiProviders || config.aiProviders.length === 0) {
    errors.push('At least one AI provider is required');
  }

  if (!config.defaultModel || !config.defaultModel.provider || !config.defaultModel.model) {
    errors.push('Default model configuration is required');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
