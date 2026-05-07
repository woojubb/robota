import type { ITemplate } from '../types';

export const basicChatTemplate: ITemplate = {
  id: 'basic-chat',
  name: 'Basic Chat Agent',
  description: 'A simple conversational agent perfect for getting started with Robota',
  category: 'basic',
  provider: 'openai',
  difficulty: 'beginner',
  features: ['Text conversation', 'System prompts', 'Basic responses'],
  estimatedTime: '5 minutes',
  useCases: ['Customer support', 'FAQ bot', 'General assistance'],
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
Provide clear, concise answers and ask clarifying questions when needed.
\`)

export default agent`,
  config: { model: 'gpt-4', temperature: '0.7' },
};
