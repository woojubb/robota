import type { ITemplate } from '../types';

export const multiModalTemplate: ITemplate = {
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
};
