import type { ITemplate } from '../types';

export const claudeCreativeTemplate: ITemplate = {
  id: 'claude-creative',
  name: 'Claude Creative Writer',
  description: 'A creative writing assistant using Anthropic Claude for storytelling',
  category: 'creative',
  provider: 'anthropic',
  difficulty: 'beginner',
  features: ['Creative writing', 'Story generation', 'Content ideation'],
  estimatedTime: '10 minutes',
  useCases: ['Content creation', 'Storytelling', 'Creative brainstorming'],
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

Guidelines:
- Be imaginative and supportive
- Provide constructive feedback
- Suggest creative alternatives
- Help with plot development, character creation, and world-building
- Maintain the user's voice and style preferences
\`)

export default agent`,
  config: { model: 'claude-3-opus', temperature: '0.8' },
};
