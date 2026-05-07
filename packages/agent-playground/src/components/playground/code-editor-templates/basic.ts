import type { IExampleTemplate } from './types';

export const basicTemplate: IExampleTemplate = {
  name: 'Basic Conversation',
  description: 'Simple AI conversation using OpenAI provider',
  code: `// Basic Conversation Example
import OpenAI from 'openai'
import { Robota } from '@robota-sdk/agent-core'
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai'

// Basic Conversation Example Started

// Create OpenAI client and provider
const openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'your-api-key-here'
})

const openaiProvider = new OpenAIProvider({
    client: openaiClient,
    model: 'gpt-3.5-turbo'
})

// Create Robota instance
const robota = new Robota({
    name: 'BasicAgent',
    aiProviders: [openaiProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        systemMessage: 'You are a helpful AI assistant.'
    }
})

// Simple conversation
const response = await robota.run('Hello! What can you tell me about AI agents?')
// response contains the assistant output

// Clean up
await robota.destroy()`,
};
