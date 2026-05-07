import type { ITemplate } from '../types';

export const toolEnabledTemplate: ITemplate = {
  id: 'tool-enabled',
  name: 'Tool-Enabled Assistant',
  description: 'An intelligent agent with access to external tools and functions',
  category: 'tools',
  provider: 'openai',
  difficulty: 'intermediate',
  features: ['Function calling', 'External APIs', 'Tool management'],
  estimatedTime: '15 minutes',
  useCases: ['Data analysis', 'API integration', 'Workflow automation'],
  code: `import { Agent } from '@robota/agents'
import { OpenAIProvider } from '@robota/openai'

const agent = new Agent({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4'
  })
})

// Add current time tool
agent.addTool({
  name: 'getCurrentTime',
  description: 'Get the current date and time',
  execute: async () => {
    return new Date().toLocaleString()
  }
})

// Add weather tool (mock)
agent.addTool({
  name: 'getWeather',
  description: 'Get weather information for a city',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'The city name' }
    },
    required: ['city']
  },
  execute: async ({ city }: { city: string }) => {
    return \`The weather in \${city} is sunny with 22°C\`
  }
})

agent.setSystemMessage(\`
You are a helpful assistant with access to real-time information.
Use your tools when appropriate to provide accurate and helpful responses.
Always explain what tool you're using and why.
\`)

export default agent`,
  config: { model: 'gpt-4', temperature: '0.7' },
};
