import { createAnthropicProviderDefinition } from '../anthropic/index';
import { createGeminiProviderDefinition } from '../gemini/index';
import { createOpenAIProviderDefinition } from '../openai/index';
import { createDeepSeekProviderDefinition } from '../deepseek/index';
import { createGemmaProviderDefinition } from '../gemma/index';
import { createQwenProviderDefinition } from '../qwen/index';

import type { IProviderDefinition } from '@robota-sdk/agent-core';

import { createOpenRouterProviderDefinition } from './openrouter-definition.js';

export function createDefaultProviderDefinitions(): readonly IProviderDefinition[] {
  return [
    createAnthropicProviderDefinition(),
    createOpenAIProviderDefinition(),
    createGeminiProviderDefinition(),
    createGemmaProviderDefinition(),
    createQwenProviderDefinition(),
    createDeepSeekProviderDefinition(),
    createOpenRouterProviderDefinition(),
  ];
}
