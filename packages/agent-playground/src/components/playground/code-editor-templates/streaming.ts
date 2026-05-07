import type { IExampleTemplate } from './types';

export const streamingTemplate: IExampleTemplate = {
  name: 'Streaming Response',
  description: 'Real-time streaming of AI responses',
  code: `// Streaming Response Example
import OpenAI from 'openai'
import { Robota } from '@robota-sdk/agent-core'
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai'

// Streaming Example Started

const robota = new Robota({
    name: 'StreamingAgent',
    aiProviders: [new OpenAIProvider({
        client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
        model: 'gpt-3.5-turbo'
    })],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        systemMessage: 'You are a creative storyteller.'
    }
})

// Streaming output:

// Stream response chunk by chunk
for await (const chunk of robota.runStream('Tell me a short story about robots and humans working together')) {
    // chunk received
    // Simulate real-time display with small delay
    await new Promise(resolve => setTimeout(resolve, 50))
}

// Story completed

await robota.destroy()`,
};
