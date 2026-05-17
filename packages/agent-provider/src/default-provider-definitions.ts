import type { IProviderDefinition } from '@robota-sdk/agent-core';
import { createAnthropicProviderDefinition } from './anthropic/index.js';
import { createDeepSeekProviderDefinition } from './deepseek/index.js';
import { createGemmaProviderDefinition } from './gemma/index.js';
import { createGeminiProviderDefinition } from './gemini/index.js';
import { createOpenAIProviderDefinition } from './openai/index.js';
import { createQwenProviderDefinition } from './qwen/index.js';

export function createDefaultProviderDefinitions(): readonly IProviderDefinition[] {
  return [
    createAnthropicProviderDefinition(),
    createOpenAIProviderDefinition(),
    createGeminiProviderDefinition(),
    createGemmaProviderDefinition(),
    createQwenProviderDefinition(),
    createDeepSeekProviderDefinition(),
  ];
}
