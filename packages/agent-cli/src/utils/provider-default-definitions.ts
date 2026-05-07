import { createAnthropicProviderDefinition } from '@robota-sdk/agent-provider-anthropic';
import { createDeepSeekProviderDefinition } from '@robota-sdk/agent-provider-deepseek';
import { createGemmaProviderDefinition } from '@robota-sdk/agent-provider-gemma';
import { createGeminiProviderDefinition } from '@robota-sdk/agent-provider-gemini';
import { createOpenAIProviderDefinition } from '@robota-sdk/agent-provider-openai';
import { createQwenProviderDefinition } from '@robota-sdk/agent-provider-qwen';
import type { IProviderDefinition } from './provider-definition.js';

export const DEFAULT_PROVIDER_DEFINITIONS: readonly IProviderDefinition[] = [
  createAnthropicProviderDefinition(),
  createOpenAIProviderDefinition(),
  createGeminiProviderDefinition(),
  createGemmaProviderDefinition(),
  createQwenProviderDefinition(),
  createDeepSeekProviderDefinition(),
];
