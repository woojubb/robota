/**
 * Built-in templates for ProjectManager
 */

import type { IPlaygroundProject } from './project-manager';

const CURRENT_VERSION = '1.0.0';

export function getBuiltinTemplates(): Array<
  Omit<IPlaygroundProject, 'id' | 'createdAt' | 'updatedAt'>
> {
  return [
    {
      name: 'Basic Chat Agent',
      description: 'A simple conversational agent with OpenAI',
      code: `import { Agent } from '@robota/agents'
import { OpenAIProvider } from '@robota/openai'

const agent = new Agent({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4'
  })
})

agent.setSystemMessage(\`
You are a helpful AI assistant. Always be polite and professional.
\`)

export default agent`,
      provider: 'openai',
      config: { model: 'gpt-4', temperature: '0.7' },
      version: CURRENT_VERSION,
    },
    {
      name: 'Tool-Enabled Agent',
      description: 'An agent with custom tools for enhanced functionality',
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
  execute: async (city: string) => {
    return \`The weather in \${city} is sunny with 22°C\`
  }
})

agent.setSystemMessage(\`
You are a helpful assistant with access to real-time information.
Use your tools when appropriate to provide accurate and helpful responses.
\`)

export default agent`,
      provider: 'openai',
      config: { model: 'gpt-4', temperature: '0.7' },
      version: CURRENT_VERSION,
    },
    {
      name: 'Claude Creative Assistant',
      description: 'A creative writing assistant using Anthropic Claude',
      code: `import { Agent } from '@robota/agents'
import { AnthropicProvider } from '@robota/anthropic'

const agent = new Agent({
  provider: new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-3-opus'
  })
})

agent.setSystemMessage(\`
You are a creative writing assistant specializing in storytelling and creative content.
Help users brainstorm ideas, improve their writing, and create engaging narratives.
Be imaginative, supportive, and provide constructive feedback.
\`)

export default agent`,
      provider: 'anthropic',
      config: { model: 'claude-3-opus', temperature: '0.8' },
      version: CURRENT_VERSION,
    },
  ];
}
