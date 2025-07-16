/**
 * Project management for the Robota Playground
 * Handles saving, loading, and managing playground projects
 */

export interface PlaygroundProject {
    id: string
    name: string
    description?: string
    code: string
    provider: string
    config: {
        model: string
        temperature: string
        [key: string]: any
    }
    createdAt: Date
    updatedAt: Date
    version: string
}

export interface ProjectMetadata {
    id: string
    name: string
    description?: string
    createdAt: Date
    updatedAt: Date
    provider: string
    linesOfCode: number
}

const STORAGE_KEY = 'robota-playground-projects'
const CURRENT_VERSION = '1.0.0'

export class ProjectManager {
    private static instance: ProjectManager
    private projects: Map<string, PlaygroundProject> = new Map()

    private constructor() {
        this.loadFromStorage()
    }

    static getInstance(): ProjectManager {
        if (!ProjectManager.instance) {
            ProjectManager.instance = new ProjectManager()
        }
        return ProjectManager.instance
    }

    private loadFromStorage(): void {
        try {
            const stored = localStorage.getItem(STORAGE_KEY)
            if (stored) {
                const data = JSON.parse(stored)
                this.projects = new Map(
                    data.map((project: any) => [
                        project.id,
                        {
                            ...project,
                            createdAt: new Date(project.createdAt),
                            updatedAt: new Date(project.updatedAt)
                        }
                    ])
                )
            }
        } catch (error) {
            console.error('Failed to load projects from storage:', error)
            this.projects = new Map()
        }
    }

    private saveToStorage(): void {
        try {
            const data = Array.from(this.projects.values())
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
        } catch (error) {
            console.error('Failed to save projects to storage:', error)
        }
    }

    saveProject(projectData: Omit<PlaygroundProject, 'id' | 'createdAt' | 'updatedAt' | 'version'>): string {
        const now = new Date()
        const id = this.generateId()

        const project: PlaygroundProject = {
            ...projectData,
            id,
            createdAt: now,
            updatedAt: now,
            version: CURRENT_VERSION
        }

        this.projects.set(id, project)
        this.saveToStorage()

        return id
    }

    updateProject(id: string, updates: Partial<Omit<PlaygroundProject, 'id' | 'createdAt' | 'version'>>): boolean {
        const project = this.projects.get(id)
        if (!project) return false

        const updatedProject: PlaygroundProject = {
            ...project,
            ...updates,
            updatedAt: new Date()
        }

        this.projects.set(id, updatedProject)
        this.saveToStorage()

        return true
    }

    loadProject(id: string): PlaygroundProject | null {
        return this.projects.get(id) || null
    }

    deleteProject(id: string): boolean {
        const deleted = this.projects.delete(id)
        if (deleted) {
            this.saveToStorage()
        }
        return deleted
    }

    listProjects(): ProjectMetadata[] {
        return Array.from(this.projects.values())
            .map(project => ({
                id: project.id,
                name: project.name,
                description: project.description,
                createdAt: project.createdAt,
                updatedAt: project.updatedAt,
                provider: project.provider,
                linesOfCode: project.code.split('\n').length
            }))
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    }

    exportProject(id: string): string | null {
        const project = this.projects.get(id)
        if (!project) return null

        return JSON.stringify(project, null, 2)
    }

    importProject(jsonData: string): string | null {
        try {
            const projectData = JSON.parse(jsonData)

            // Validate required fields
            if (!projectData.name || !projectData.code || !projectData.provider) {
                throw new Error('Invalid project data: missing required fields')
            }

            // Generate new ID and timestamps for imported project
            const id = this.generateId()
            const now = new Date()

            const project: PlaygroundProject = {
                id,
                name: `${projectData.name} (Imported)`,
                description: projectData.description,
                code: projectData.code,
                provider: projectData.provider,
                config: projectData.config || { model: 'gpt-4', temperature: '0.7' },
                createdAt: now,
                updatedAt: now,
                version: CURRENT_VERSION
            }

            this.projects.set(id, project)
            this.saveToStorage()

            return id
        } catch (error) {
            console.error('Failed to import project:', error)
            return null
        }
    }

    duplicateProject(id: string): string | null {
        const original = this.projects.get(id)
        if (!original) return null

        const newId = this.generateId()
        const now = new Date()

        const duplicate: PlaygroundProject = {
            ...original,
            id: newId,
            name: `${original.name} (Copy)`,
            createdAt: now,
            updatedAt: now
        }

        this.projects.set(newId, duplicate)
        this.saveToStorage()

        return newId
    }

    getProjectStats(): {
        totalProjects: number
        totalLinesOfCode: number
        providers: Record<string, number>
        recentActivity: number
    } {
        const projects = Array.from(this.projects.values())
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

        const providers: Record<string, number> = {}
        let totalLinesOfCode = 0
        let recentActivity = 0

        for (const project of projects) {
            totalLinesOfCode += project.code.split('\n').length
            providers[project.provider] = (providers[project.provider] || 0) + 1

            if (project.updatedAt > oneWeekAgo) {
                recentActivity++
            }
        }

        return {
            totalProjects: projects.length,
            totalLinesOfCode,
            providers,
            recentActivity
        }
    }

    searchProjects(query: string): ProjectMetadata[] {
        const lowercaseQuery = query.toLowerCase()

        return this.listProjects().filter(project =>
            project.name.toLowerCase().includes(lowercaseQuery) ||
            (project.description && project.description.toLowerCase().includes(lowercaseQuery)) ||
            project.provider.toLowerCase().includes(lowercaseQuery)
        )
    }

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2)
    }

    // Template management
    getBuiltinTemplates(): Omit<PlaygroundProject, 'id' | 'createdAt' | 'updatedAt'>[] {
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
                version: CURRENT_VERSION
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
                version: CURRENT_VERSION
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
                version: CURRENT_VERSION
            }
        ]
    }

    createFromTemplate(templateIndex: number): string | null {
        const templates = this.getBuiltinTemplates()
        const template = templates[templateIndex]

        if (!template) return null

        return this.saveProject(template)
    }
} 