/**
 * Project management for the Robota Playground
 * Handles saving, loading, and managing playground projects
 */

const DAYS_PER_WEEK = 7;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const RANDOM_ID_BASE = 36;

import { WebLogger } from '../web-logger'
import type { TUniversalValue } from '@robota-sdk/agents'

export type TPlaygroundProvider = 'openai' | 'anthropic' | 'google'

function isPlaygroundProvider(value: TUniversalValue): value is TPlaygroundProvider {
    return value === 'openai' || value === 'anthropic' || value === 'google'
}

export interface IProjectConfig extends Record<string, TUniversalValue> {
    model: string
    temperature: string
}

export interface IPlaygroundProject {
    id: string
    name: string
    description?: string
    code: string
    provider: TPlaygroundProvider
    config: IProjectConfig
    createdAt: Date
    updatedAt: Date
    version: string
}

export interface IProjectMetadata {
    id: string
    name: string
    description?: string
    createdAt: Date
    updatedAt: Date
    provider: TPlaygroundProvider
    linesOfCode: number
}

interface IProjectSettings extends Record<string, TUniversalValue> {
    provider: TPlaygroundProvider
    model?: string
    temperature?: string
}

interface IProjectStats {
    totalProjects: number
    totalLinesOfCode: number
    providers: Record<TPlaygroundProvider, number>
    recentActivity: number
}

const STORAGE_KEY = 'robota-playground-projects'
const CURRENT_VERSION = '1.0.0'

export class ProjectManager {
    private static instance: ProjectManager
    private projects: Map<string, IPlaygroundProject> = new Map()

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
                const parsed: TUniversalValue = JSON.parse(stored) as TUniversalValue
                if (!Array.isArray(parsed)) {
                    WebLogger.error('Failed to load projects from storage', { error: 'Stored data is not an array' })
                    this.projects = new Map()
                    return
                }

                const projects: Array<[string, IPlaygroundProject]> = []
                for (const item of parsed) {
                    if (typeof item !== 'object' || item === null || Array.isArray(item) || item instanceof Date) {
                        continue
                    }

                    const record = item as Record<string, TUniversalValue>
                    const id = record.id
                    const name = record.name
                    const code = record.code
                    const provider = record.provider
                    const createdAt = record.createdAt
                    const updatedAt = record.updatedAt
                    const version = record.version
                    const description = record.description
                    const config = record.config

                    if (typeof id !== 'string' || typeof name !== 'string' || typeof code !== 'string' || typeof version !== 'string') {
                        continue
                    }
                    if (!isPlaygroundProvider(provider)) {
                        continue
                    }
                    if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') {
                        continue
                    }
                    if (typeof config !== 'object' || config === null || Array.isArray(config) || config instanceof Date) {
                        continue
                    }

                    const configRecord = config as Record<string, TUniversalValue>
                    const model = configRecord.model
                    const temperature = configRecord.temperature
                    if (typeof model !== 'string' || typeof temperature !== 'string') {
                        continue
                    }

                    const project: IPlaygroundProject = {
                        id,
                        name,
                        description: typeof description === 'string' ? description : undefined,
                        code,
                        provider,
                        config: { ...configRecord, model, temperature },
                        createdAt: new Date(createdAt),
                        updatedAt: new Date(updatedAt),
                        version,
                    }

                    projects.push([id, project])
                }

                this.projects = new Map(projects)
            }
        } catch (error) {
            WebLogger.error('Failed to load projects from storage', { error: error instanceof Error ? error.message : String(error) })
            this.projects = new Map()
        }
    }

    private saveToStorage(): void {
        try {
            const data = Array.from(this.projects.values())
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
        } catch (error) {
            WebLogger.error('Failed to save projects to storage', { error: error instanceof Error ? error.message : String(error) })
        }
    }

    // New method: getAllProjects - returns all projects as an array
    getAllProjects(): IPlaygroundProject[] {
        return Array.from(this.projects.values())
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    }

    // New method: createProject - creates a new project with given settings
    createProject(name: string, description: string = '', settings: IProjectSettings): IPlaygroundProject {
        const now = new Date()
        const id = this.generateId()

        const { provider, ...configExtras } = settings

        const project: IPlaygroundProject = {
            id,
            name,
            description,
            code: this.getDefaultCodeForProvider(provider),
            provider,
            config: {
                model: typeof settings.model === 'string' ? settings.model : this.getDefaultModelForProvider(provider),
                temperature: typeof settings.temperature === 'string' ? settings.temperature : '0.7',
                ...configExtras
            },
            createdAt: now,
            updatedAt: now,
            version: CURRENT_VERSION
        }

        this.projects.set(id, project)
        this.saveToStorage()

        return project
    }

    // New method: importProject - imports a project from JSON data
    importProject(projectData: TUniversalValue): IPlaygroundProject {
        if (typeof projectData !== 'object' || projectData === null || Array.isArray(projectData) || projectData instanceof Date) {
            throw new Error('Invalid project data: expected an object')
        }

        const record = projectData as Record<string, TUniversalValue>
        const name = record.name
        const code = record.code
        const provider = record.provider
        const description = record.description
        const config = record.config

        if (typeof name !== 'string' || typeof code !== 'string') {
            throw new Error('Invalid project data: missing required fields')
        }
        if (!isPlaygroundProvider(provider)) {
            throw new Error('Invalid project data: invalid provider')
        }
        if (typeof config !== 'object' || config === null || Array.isArray(config) || config instanceof Date) {
            throw new Error('Invalid project data: invalid config')
        }

        const configRecord = config as Record<string, TUniversalValue>
        const model = configRecord.model
        const temperature = configRecord.temperature
        if (typeof model !== 'string' || typeof temperature !== 'string') {
            throw new Error('Invalid project data: config.model and config.temperature are required')
        }

        // Generate new ID and timestamps for imported project
        const id = this.generateId()
        const now = new Date()

        const project: IPlaygroundProject = {
            id,
            name: `${name} (Imported)`,
            description: typeof description === 'string' ? description : undefined,
            code,
            provider,
            config: { ...configRecord, model, temperature },
            createdAt: now,
            updatedAt: now,
            version: CURRENT_VERSION
        }

        this.projects.set(id, project)
        this.saveToStorage()

        return project
    }

    private getDefaultCodeForProvider(provider: TPlaygroundProvider): string {
        const templates = this.getBuiltinTemplates()
        const template = templates.find(t => t.provider === provider)
        if (!template) {
            throw new Error(`Missing built-in template for provider: ${provider}`)
        }
        return template.code
    }

    private getDefaultModelForProvider(provider: TPlaygroundProvider): string {
        switch (provider) {
            case 'openai': return 'gpt-4'
            case 'anthropic': return 'claude-3-opus'
            case 'google': return 'gemini-pro'
        }
    }

    saveProject(projectData: Omit<IPlaygroundProject, 'id' | 'createdAt' | 'updatedAt' | 'version'>): string {
        const now = new Date()
        const id = this.generateId()

        const project: IPlaygroundProject = {
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

    updateProject(id: string, updates: Partial<Omit<IPlaygroundProject, 'id' | 'createdAt' | 'version'>>): boolean {
        const project = this.projects.get(id)
        if (!project) return false

        const updatedProject: IPlaygroundProject = {
            ...project,
            ...updates,
            updatedAt: new Date()
        }

        this.projects.set(id, updatedProject)
        this.saveToStorage()

        return true
    }

    loadProject(id: string): IPlaygroundProject | null {
        return this.projects.get(id) || null
    }

    deleteProject(id: string): boolean {
        const deleted = this.projects.delete(id)
        if (deleted) {
            this.saveToStorage()
        }
        return deleted
    }

    listProjects(): IProjectMetadata[] {
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

    duplicateProject(id: string): string | null {
        const original = this.projects.get(id)
        if (!original) return null

        const newId = this.generateId()
        const now = new Date()

        const duplicate: IPlaygroundProject = {
            ...original,
            id: newId,
            name: `${original.name} (Replica)`,
            createdAt: now,
            updatedAt: now
        }

        this.projects.set(newId, duplicate)
        this.saveToStorage()

        return newId
    }

    getProjectStats(): IProjectStats {
        const projects = Array.from(this.projects.values())
        const oneWeekAgo = new Date(Date.now() - DAYS_PER_WEEK * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND)

        const providers: Record<TPlaygroundProvider, number> = { openai: 0, anthropic: 0, google: 0 }
        let totalLinesOfCode = 0
        let recentActivity = 0

        for (const project of projects) {
            totalLinesOfCode += project.code.split('\n').length
            providers[project.provider] += 1

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

    searchProjects(query: string): IProjectMetadata[] {
        const lowercaseQuery = query.toLowerCase()

        return this.listProjects().filter(project =>
            project.name.toLowerCase().includes(lowercaseQuery) ||
            (project.description && project.description.toLowerCase().includes(lowercaseQuery)) ||
            project.provider.toLowerCase().includes(lowercaseQuery)
        )
    }

    private generateId(): string {
        return Date.now().toString(RANDOM_ID_BASE) + Math.random().toString(RANDOM_ID_BASE).substr(2)
    }

    // Template management
    getBuiltinTemplates(): Array<Omit<IPlaygroundProject, 'id' | 'createdAt' | 'updatedAt'>> {
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