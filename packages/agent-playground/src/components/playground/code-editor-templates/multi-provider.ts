import type { IExampleTemplate } from './types';

export const multiProviderTemplate: IExampleTemplate = {
  name: 'Multi-Provider',
  description: 'Using multiple AI providers in one application',
  code: `// Multi-Provider Example
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { Robota } from '@robota-sdk/agent-core'
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai'
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic'

// Multi-Provider Example Started

// Create multiple providers
const openaiProvider = new OpenAIProvider({
    client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    model: 'gpt-3.5-turbo'
})

const anthropicProvider = new AnthropicProvider({
    client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    model: 'claude-3-haiku-20240307'
})

// Create agent with multiple providers
const robota = new Robota({
    name: 'MultiProviderAgent',
    aiProviders: [openaiProvider, anthropicProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        systemMessage: 'You are a helpful AI assistant.'
    }
})

const question = 'Explain quantum computing in simple terms'

// Test with OpenAI
// OpenAI Response:
// User: \${question}
let response = await robota.run(question)
// Assistant: \${response}

// Switch to Anthropic
// Note: Provider switching would require additional configuration
// This is a conceptual example
// Anthropic Response:
// User: \${question}
// response = await robota.run(question, { provider: 'anthropic' })
// Provider switching requires additional setup

await robota.destroy()`,
};
