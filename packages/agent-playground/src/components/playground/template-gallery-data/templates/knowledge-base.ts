import type { ITemplate } from '../types';

export const knowledgeBaseTemplate: ITemplate = {
  id: 'knowledge-base',
  name: 'Knowledge Base Assistant',
  description: 'An agent designed to work with documents and knowledge bases',
  category: 'business',
  provider: 'anthropic',
  difficulty: 'intermediate',
  features: ['Document search', 'Knowledge retrieval', 'RAG integration'],
  estimatedTime: '18 minutes',
  useCases: ['Documentation support', 'Knowledge management', 'Q&A systems'],
  code: `import { Agent } from '@robota/agents'
import { AnthropicProvider } from '@robota/anthropic'

const agent = new Agent({
  provider: new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-3-sonnet'
  })
})

agent.addTool({
  name: 'searchDocuments',
  description: 'Search through knowledge base documents',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      category: { type: 'string', description: 'Document category' }
    },
    required: ['query']
  },
  execute: async ({ query, category }: { query: string, category?: string }) => {
    return \`Found 3 documents matching "\${query}"\${category ? \` in category \${category}\` : ''}\`
  }
})

agent.addTool({
  name: 'getKnowledgeItem',
  description: 'Retrieve specific knowledge base item',
  parameters: {
    type: 'object',
    properties: {
      itemId: { type: 'string', description: 'Knowledge item ID' }
    },
    required: ['itemId']
  },
  execute: async ({ itemId }: { itemId: string }) => {
    return \`Knowledge item \${itemId}: Detailed information about the requested topic.\`
  }
})

agent.setSystemMessage(\`
You are a knowledge base assistant specializing in information retrieval and documentation support.

Your expertise includes:
- Searching and retrieving relevant documents
- Summarizing complex information
- Connecting related concepts
- Providing accurate citations
- Organizing information hierarchically

Always cite your sources and provide context for the information you share.
Help users find exactly what they need quickly and efficiently.
\`)

export default agent`,
  config: { model: 'claude-3-sonnet', temperature: '0.2' },
};
