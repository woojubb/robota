/**
 * Template definitions and display configuration for TemplateGallery
 */

import { MessageSquare, Wrench, Sparkles, FileText, Zap } from 'lucide-react';
import type { TPlaygroundProvider } from '../../lib/playground/project-manager';

export interface ITemplate {
  id: string;
  name: string;
  description: string;
  category: 'basic' | 'tools' | 'creative' | 'business' | 'advanced';
  provider: TPlaygroundProvider;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  features: string[];
  code: string;
  estimatedTime: string;
  useCases: string[];
  config: {
    model: string;
    temperature: string;
  };
}

export interface ITemplateGalleryProps {
  onSelectTemplate: (template: ITemplate) => void;
  onClose?: () => void;
}

export const categoryIcons = {
  basic: MessageSquare,
  tools: Wrench,
  creative: Sparkles,
  business: FileText,
  advanced: Zap,
};

export const providerIcons = {
  openai: '🤖',
  anthropic: '🧠',
  google: '🔍',
};

export const difficultyColors = {
  beginner: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  intermediate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  advanced: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};

export const templates: ITemplate[] = [
  {
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
  },
  {
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
  },
  {
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
  },
  {
    id: 'business-analyst',
    name: 'Business Data Analyst',
    description: 'A professional agent for business analysis and data insights',
    category: 'business',
    provider: 'openai',
    difficulty: 'advanced',
    features: ['Data analysis', 'Business insights', 'Report generation'],
    estimatedTime: '20 minutes',
    useCases: ['Business intelligence', 'Data reporting', 'Market analysis'],
    code: `import { Agent } from '@robota/agents'
import { OpenAIProvider } from '@robota/openai'

const agent = new Agent({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4'
  })
})

agent.addTool({
  name: 'analyzeData',
  description: 'Analyze business data and provide insights',
  parameters: {
    type: 'object',
    properties: {
      data: { type: 'array', description: 'Array of data points' },
      metric: { type: 'string', description: 'Metric to analyze' }
    },
    required: ['data', 'metric']
  },
  execute: async ({ data, metric }: { data: Array<{ value?: number }>, metric: string }) => {
    const total = data.length
    const avg = data.reduce((a, b) => a + (b.value || 0), 0) / total
    return \`Analysis for \${metric}: Total entries: \${total}, Average: \${avg.toFixed(2)}\`
  }
})

agent.addTool({
  name: 'generateReport',
  description: 'Generate a business report summary',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Report title' },
      findings: { type: 'array', description: 'Key findings' }
    },
    required: ['title', 'findings']
  },
  execute: async ({ title, findings }: { title: string, findings: string[] }) => {
    return \`# \${title}\n\n## Key Findings\n\${findings.map(f => \`- \${f}\`).join('\n')}\`
  }
})

agent.setSystemMessage(\`
You are a professional business data analyst with expertise in:
- Statistical analysis and data interpretation
- Business intelligence and KPI tracking
- Market trend analysis
- Financial modeling and forecasting
- Report writing and presentation

Provide clear, actionable insights and always support your recommendations with data.
Use charts, tables, and visual aids when describing complex data.
\`)

export default agent`,
    config: { model: 'gpt-4', temperature: '0.3' },
  },
  {
    id: 'multi-modal',
    name: 'Multi-Modal Assistant',
    description: 'Advanced agent with image processing and multi-modal capabilities',
    category: 'advanced',
    provider: 'google',
    difficulty: 'advanced',
    features: ['Image analysis', 'Multi-modal input', 'Vision AI'],
    estimatedTime: '25 minutes',
    useCases: ['Image analysis', 'Visual content creation', 'Document processing'],
    code: `import { Agent } from '@robota/agents'
import { GoogleProvider } from '@robota/google'

const agent = new Agent({
  provider: new GoogleProvider({
    apiKey: process.env.GOOGLE_API_KEY,
    model: 'gemini-pro-vision'
  })
})

agent.addTool({
  name: 'analyzeImage',
  description: 'Analyze images and provide detailed descriptions',
  parameters: {
    type: 'object',
    properties: {
      imageUrl: { type: 'string', description: 'URL of the image to analyze' }
    },
    required: ['imageUrl']
  },
  execute: async ({ imageUrl }: { imageUrl: string }) => {
    return \`Image analysis for \${imageUrl}: This appears to be a professional photograph with good lighting and composition.\`
  }
})

agent.addTool({
  name: 'extractText',
  description: 'Extract text from images using OCR',
  parameters: {
    type: 'object',
    properties: {
      imageUrl: { type: 'string', description: 'URL of the image containing text' }
    },
    required: ['imageUrl']
  },
  execute: async ({ imageUrl }: { imageUrl: string }) => {
    return \`Extracted text from \${imageUrl}: Sample text content from the image.\`
  }
})

agent.setSystemMessage(\`
You are an advanced multi-modal AI assistant with vision capabilities.
You can analyze images, extract text, and work with various media formats.

Capabilities:
- Image analysis and description
- Text extraction from images (OCR)
- Visual content understanding
- Multi-modal reasoning

Always provide detailed, accurate descriptions and be specific about what you observe.
\`)

export default agent`,
    config: { model: 'gemini-pro-vision', temperature: '0.4' },
  },
  {
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
  },
];
