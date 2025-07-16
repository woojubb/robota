"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import {
    Search,
    Zap,
    Code,
    MessageSquare,
    Wrench,
    FileText,
    Globe,
    Database,
    Bot,
    Sparkles,
    ArrowRight,
    Clock,
    Users
} from 'lucide-react';
import { ProjectManager } from '@/lib/playground/project-manager';
import { useToast } from '../../hooks/use-toast';

interface Template {
    id: string;
    name: string;
    description: string;
    category: 'basic' | 'tools' | 'creative' | 'business' | 'advanced';
    provider: 'openai' | 'anthropic' | 'google';
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

interface TemplateGalleryProps {
    onSelectTemplate: (template: Template) => void;
    onClose?: () => void;
}

const templates: Template[] = [
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
        config: { model: 'gpt-4', temperature: '0.7' }
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
        config: { model: 'gpt-4', temperature: '0.7' }
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
        config: { model: 'claude-3-opus', temperature: '0.8' }
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

// Add data analysis tool
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
  execute: async ({ data, metric }: { data: any[], metric: string }) => {
    // Mock data analysis
    const total = data.length
    const avg = data.reduce((a, b) => a + (b.value || 0), 0) / total
    return \`Analysis for \${metric}: Total entries: \${total}, Average: \${avg.toFixed(2)}\`
  }
})

// Add report generation tool
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
        config: { model: 'gpt-4', temperature: '0.3' }
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

// Add image analysis tool
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
    // Mock image analysis
    return \`Image analysis for \${imageUrl}: This appears to be a professional photograph with good lighting and composition.\`
  }
})

// Add OCR tool
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
    // Mock OCR
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
        config: { model: 'gemini-pro-vision', temperature: '0.4' }
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

// Add document search tool
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
    // Mock document search
    return \`Found 3 documents matching "\${query}"\${category ? \` in category \${category}\` : ''}\`
  }
})

// Add knowledge retrieval tool
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
        config: { model: 'claude-3-sonnet', temperature: '0.2' }
    }
];

const categoryIcons = {
    basic: MessageSquare,
    tools: Wrench,
    creative: Sparkles,
    business: FileText,
    advanced: Zap
};

const providerIcons = {
    openai: '🤖',
    anthropic: '🧠',
    google: '🔍'
};

const difficultyColors = {
    beginner: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    intermediate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
    advanced: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
};

export function TemplateGallery({ onSelectTemplate, onClose }: TemplateGalleryProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [selectedProvider, setSelectedProvider] = useState<string>('all');
    const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
    const { toast } = useToast();

    const filteredTemplates = templates.filter(template => {
        const matchesSearch = template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            template.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
            template.useCases.some(useCase => useCase.toLowerCase().includes(searchTerm.toLowerCase()));
        const matchesCategory = selectedCategory === 'all' || template.category === selectedCategory;
        const matchesProvider = selectedProvider === 'all' || template.provider === selectedProvider;

        return matchesSearch && matchesCategory && matchesProvider;
    });

    const handleUseTemplate = (template: Template) => {
        onSelectTemplate(template);
        onClose?.();

        toast({
            title: "Template Applied",
            description: `"${template.name}" has been loaded successfully`
        });
    };

    const handleCreateProject = (template: Template) => {
        const projectManager = ProjectManager.getInstance();
        const project = projectManager.createProject(
            template.name,
            template.description,
            {
                provider: template.provider,
                model: template.config.model,
                temperature: template.config.temperature
            }
        );

        // Update with template code
        projectManager.updateProject(project.id, {
            code: template.code
        });

        onSelectTemplate({
            ...template,
            code: template.code
        });
        onClose?.();

        toast({
            title: "Project Created",
            description: `New project "${template.name}" created from template`
        });
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="text-center">
                <h2 className="text-3xl font-bold mb-2">Template Gallery</h2>
                <p className="text-muted-foreground max-w-2xl mx-auto">
                    Kickstart your AI agent development with our curated collection of templates.
                    Choose from basic chat bots to advanced multi-modal assistants.
                </p>
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                        <Input
                            placeholder="Search templates..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10"
                        />
                    </div>
                </div>
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                    <SelectTrigger className="w-40">
                        <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        <SelectItem value="basic">Basic</SelectItem>
                        <SelectItem value="tools">Tools</SelectItem>
                        <SelectItem value="creative">Creative</SelectItem>
                        <SelectItem value="business">Business</SelectItem>
                        <SelectItem value="advanced">Advanced</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                    <SelectTrigger className="w-32">
                        <SelectValue placeholder="Provider" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Providers</SelectItem>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="anthropic">Anthropic</SelectItem>
                        <SelectItem value="google">Google</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Results Info */}
            <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                    {filteredTemplates.length} template{filteredTemplates.length !== 1 ? 's' : ''} found
                </p>
            </div>

            {/* Template Grid */}
            <ScrollArea className="h-[600px]">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredTemplates.map((template) => {
                        const CategoryIcon = categoryIcons[template.category];

                        return (
                            <Card key={template.id} className="group hover:shadow-lg transition-all duration-200">
                                <CardHeader className="pb-3">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center space-x-2">
                                            <CategoryIcon className="w-5 h-5 text-primary" />
                                            <Badge className={difficultyColors[template.difficulty]}>
                                                {template.difficulty}
                                            </Badge>
                                        </div>
                                        <Badge variant="secondary" className="text-xs">
                                            {providerIcons[template.provider]} {template.provider}
                                        </Badge>
                                    </div>
                                    <CardTitle className="text-lg">{template.name}</CardTitle>
                                    <CardDescription className="line-clamp-2">
                                        {template.description}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {/* Features */}
                                    <div>
                                        <h4 className="text-sm font-medium mb-2">Features</h4>
                                        <div className="flex flex-wrap gap-1">
                                            {template.features.slice(0, 3).map((feature, index) => (
                                                <Badge key={index} variant="outline" className="text-xs">
                                                    {feature}
                                                </Badge>
                                            ))}
                                            {template.features.length > 3 && (
                                                <Badge variant="outline" className="text-xs">
                                                    +{template.features.length - 3} more
                                                </Badge>
                                            )}
                                        </div>
                                    </div>

                                    {/* Time & Use Cases */}
                                    <div className="space-y-2 text-xs text-muted-foreground">
                                        <div className="flex items-center space-x-1">
                                            <Clock className="w-3 h-3" />
                                            <span>{template.estimatedTime}</span>
                                        </div>
                                        <div className="flex items-center space-x-1">
                                            <Users className="w-3 h-3" />
                                            <span>{template.useCases[0]}</span>
                                            {template.useCases.length > 1 && (
                                                <span>+{template.useCases.length - 1} more</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex space-x-2 pt-2">
                                        <Button
                                            size="sm"
                                            onClick={() => handleUseTemplate(template)}
                                            className="flex-1"
                                        >
                                            Use Template
                                            <ArrowRight className="w-3 h-3 ml-1" />
                                        </Button>
                                        <Dialog>
                                            <DialogTrigger asChild>
                                                <Button size="sm" variant="outline" onClick={() => setSelectedTemplate(template)}>
                                                    Preview
                                                </Button>
                                            </DialogTrigger>
                                            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                                                <DialogHeader>
                                                    <DialogTitle className="flex items-center space-x-2">
                                                        <CategoryIcon className="w-5 h-5" />
                                                        <span>{template.name}</span>
                                                        <Badge className={difficultyColors[template.difficulty]}>
                                                            {template.difficulty}
                                                        </Badge>
                                                    </DialogTitle>
                                                </DialogHeader>
                                                <div className="space-y-4">
                                                    <p className="text-muted-foreground">{template.description}</p>

                                                    <div>
                                                        <h4 className="font-medium mb-2">Features</h4>
                                                        <div className="flex flex-wrap gap-1">
                                                            {template.features.map((feature, index) => (
                                                                <Badge key={index} variant="outline">
                                                                    {feature}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <h4 className="font-medium mb-2">Use Cases</h4>
                                                        <ul className="list-disc list-inside text-sm text-muted-foreground">
                                                            {template.useCases.map((useCase, index) => (
                                                                <li key={index}>{useCase}</li>
                                                            ))}
                                                        </ul>
                                                    </div>

                                                    <div>
                                                        <h4 className="font-medium mb-2">Code Preview</h4>
                                                        <div className="bg-muted p-4 rounded-lg">
                                                            <pre className="text-sm overflow-x-auto">
                                                                <code>{template.code.slice(0, 500)}...</code>
                                                            </pre>
                                                        </div>
                                                    </div>
                                                </div>
                                                <DialogFooter>
                                                    <Button variant="outline" onClick={() => handleCreateProject(template)}>
                                                        Create Project
                                                    </Button>
                                                    <Button onClick={() => handleUseTemplate(template)}>
                                                        Use Template
                                                    </Button>
                                                </DialogFooter>
                                            </DialogContent>
                                        </Dialog>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            </ScrollArea>
        </div>
    );
} 