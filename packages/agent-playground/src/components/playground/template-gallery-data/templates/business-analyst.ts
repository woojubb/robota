import type { ITemplate } from '../types';

export const businessAnalystTemplate: ITemplate = {
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
};
