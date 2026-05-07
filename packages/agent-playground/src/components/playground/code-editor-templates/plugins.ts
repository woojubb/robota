import type { IExampleTemplate } from './types';

export const pluginsTemplate: IExampleTemplate = {
  name: 'Plugins & Analytics',
  description: 'Advanced features with plugins and monitoring',
  code: `// Plugins & Analytics Example
import OpenAI from 'openai'
import {
    Robota,
    LoggingPlugin,
    UsagePlugin,
    PerformancePlugin,
    createFunctionTool
} from '@robota-sdk/agent-core'
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai'

// Plugins & Analytics Example Started

// Create a simple tool for demonstration
const timeTool = createFunctionTool(
    'getCurrentTime',
    'Get the current date and time',
    {
        type: 'object',
        properties: {
            timezone: {
                type: 'string',
                description: 'Timezone (optional)',
                default: 'UTC'
            }
        }
    },
    async (params) => {
        const { timezone = 'UTC' } = params
        const now = new Date()
        return {
            timestamp: now.toISOString(),
            readable: now.toLocaleString('en-US', { timeZone: timezone }),
            timezone
        }
    }
)

// Create agent with comprehensive plugin setup
const robota = new Robota({
    name: 'AnalyticsAgent',
    aiProviders: [new OpenAIProvider({
        client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
        model: 'gpt-3.5-turbo'
    })],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        systemMessage: 'You are a helpful assistant with time and analytics capabilities.'
    },
    tools: [timeTool],
    plugins: [
        // Logging plugin for detailed logs
        new LoggingPlugin({
            level: 'info',
            enabled: true,
            strategy: 'console'
        }),

        // Usage tracking plugin
        new UsagePlugin({
            strategy: 'memory',
            trackTokens: true,
            trackCosts: true
        }),

        // Performance monitoring plugin
        new PerformancePlugin({
            enabled: true,
            trackLatency: true,
            trackMemory: true
        })
    ],
    logging: {
        level: 'info',
        enabled: true
    }
})

// Run several queries to generate analytics data
const queries = [
    'Hello! How are you?',
    'What time is it?',
    'Can you tell me the current time in Tokyo?',
    'Explain what an AI agent is'
]

for (let i = 0; i < queries.length; i++) {
    const query = queries[i]
    // \${i + 1}. User: \${query}

    const startTime = Date.now()
    const response = await robota.run(query)
    const duration = Date.now() - startTime

    // Assistant response and duration captured
}

// Show final statistics
// Final Analytics:
const stats = robota.getStats()
// - stats contains agent metadata

await robota.destroy()`,
};
