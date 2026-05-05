import type { IExampleTemplate } from './types';

export const toolsTemplate: IExampleTemplate = {
  name: 'Function Calling',
  description: 'AI agent with custom tools and function calling',
  code: `// Function Calling Example
import OpenAI from 'openai'
import { Robota, createFunctionTool } from '@robota-sdk/agent-core'
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai'

// Tool Calling Example Started

// Create a calculator tool
const calculatorTool = createFunctionTool(
    'calculate',
    'Performs basic mathematical calculations',
    {
        type: 'object',
        properties: {
            operation: {
                type: 'string',
                enum: ['add', 'subtract', 'multiply', 'divide'],
                description: 'Mathematical operation to perform'
            },
            a: { type: 'number', description: 'First number' },
            b: { type: 'number', description: 'Second number' }
        },
        required: ['operation', 'a', 'b']
    },
    async (params) => {
        const { operation, a, b } = params
        // Calculation executed

        switch (operation) {
            case 'add': return { result: a + b }
            case 'subtract': return { result: a - b }
            case 'multiply': return { result: a * b }
            case 'divide':
                if (b === 0) throw new Error('Division by zero')
                return { result: a / b }
            default: throw new Error(\`Unknown operation: \${operation}\`)
        }
    }
)

// Create weather tool
const weatherTool = createFunctionTool(
    'getWeather',
    'Get current weather for a city',
    {
        type: 'object',
        properties: {
            city: { type: 'string', description: 'City name' },
            unit: {
                type: 'string',
                enum: ['celsius', 'fahrenheit'],
                description: 'Temperature unit'
            }
        },
        required: ['city']
    },
    async (params) => {
        const { city, unit = 'celsius' } = params
        // Weather lookup executed

        // Mock weather data
        const temp = unit === 'celsius' ? 22 : 72
        return {
            city,
            temperature: \`\${temp}°\${unit === 'celsius' ? 'C' : 'F'}\`,
            condition: 'Sunny',
            humidity: '65%'
        }
    }
)

// Create agent with tools
const robota = new Robota({
    name: 'ToolAgent',
    aiProviders: [new OpenAIProvider({
        client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
        model: 'gpt-3.5-turbo'
    })],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        systemMessage: 'You are a helpful assistant with access to calculation and weather tools.'
    },
    tools: [calculatorTool, weatherTool]
})

// Test tool calling
const queries = [
    'What is 15 multiplied by 7?',
    'What\\'s the weather like in Tokyo?',
    'Calculate 100 divided by 8, then tell me the weather in Seoul'
]

for (const query of queries) {
    // User: \${query}
    const response = await robota.run(query)
    // Assistant: \${response}
}

await robota.destroy()`,
};
