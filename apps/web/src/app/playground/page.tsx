'use client'

import { useState, useEffect } from 'react'
import { Header } from '@/components/layout/header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CodeEditor } from '@/components/playground/code-editor'
import { ChatInterface } from '@/components/playground/chat-interface'
import { ExecutionOutput } from '@/components/playground/execution-output'
import { CodeExecutor, type ExecutionResult } from '@/lib/playground/code-executor'
import { ProjectManager } from '@/lib/playground/project-manager'
import {
    Play,
    Save,
    Upload,
    Download,
    Settings,
    Code2,
    RefreshCw,
    Terminal
} from 'lucide-react'

// Playground page component
export default function PlaygroundPage() {
    const [selectedProvider, setSelectedProvider] = useState('openai')
    const [isRunning, setIsRunning] = useState(false)
    const [code, setCode] = useState('')
    const [isAgentReady, setIsAgentReady] = useState(false)
    const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null)
    const [codeExecutor] = useState(() => new CodeExecutor())
    const [projectManager] = useState(() => ProjectManager.getInstance())
    const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)

    const providers = [
        { id: 'openai', name: 'OpenAI GPT-4', icon: '🤖' },
        { id: 'anthropic', name: 'Anthropic Claude', icon: '🧠' },
        { id: 'google', name: 'Google Gemini', icon: '✨' }
    ]

    useEffect(() => {
        // Load a default template on first visit
        if (!code) {
            const templates = projectManager.getBuiltinTemplates()
            if (templates.length > 0) {
                setCode(templates[0].code)
            }
        }
    }, [code, projectManager])

    const handleRun = async () => {
        if (!code.trim()) return

        setIsRunning(true)
        setIsAgentReady(false)
        setExecutionResult(null)

        try {
            const result = await codeExecutor.executeCode(code, selectedProvider)
            setExecutionResult(result)
            setIsAgentReady(result.agentReady)
        } catch (error) {
            setExecutionResult({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                logs: ['❌ Execution failed'],
                duration: 0,
                agentReady: false
            })
        } finally {
            setIsRunning(false)
        }
    }

    const handleCodeChange = (value: string | undefined) => {
        setCode(value || '')
        setIsAgentReady(false) // Reset agent when code changes
        if (executionResult) {
            setExecutionResult(null) // Clear previous results
        }
    }

    const handleSendMessage = async (message: string): Promise<string> => {
        if (!isAgentReady) {
            throw new Error('Agent not ready. Please run your code first.')
        }

        try {
            return await codeExecutor.sendMessage(message)
        } catch (error) {
            throw new Error('Failed to send message to agent')
        }
    }

    const handleSave = async () => {
        if (!code.trim()) return

        const projectName = prompt('Enter project name:')
        if (!projectName) return

        try {
            const projectId = projectManager.saveProject({
                name: projectName,
                description: 'Created in Robota Playground',
                code,
                provider: selectedProvider,
                config: { model: 'gpt-4', temperature: '0.7' }
            })
            setCurrentProjectId(projectId)
            alert('Project saved successfully!')
        } catch (error) {
            alert('Failed to save project')
        }
    }

    const handleLoad = () => {
        const projects = projectManager.listProjects()
        if (projects.length === 0) {
            alert('No saved projects found')
            return
        }

        const projectList = projects
            .map((p, i) => `${i + 1}. ${p.name} (${p.provider})`)
            .join('\n')

        const choice = prompt(`Select project to load:\n\n${projectList}\n\nEnter number:`)
        if (!choice) return

        const index = parseInt(choice) - 1
        if (index >= 0 && index < projects.length) {
            const project = projectManager.loadProject(projects[index].id)
            if (project) {
                setCode(project.code)
                setSelectedProvider(project.provider)
                setCurrentProjectId(project.id)
                setIsAgentReady(false)
                setExecutionResult(null)
            }
        }
    }

    const handleExport = () => {
        if (!currentProjectId) {
            alert('Please save the project first')
            return
        }

        const exportData = projectManager.exportProject(currentProjectId)
        if (exportData) {
            const blob = new Blob([exportData], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `robota-project-${Date.now()}.json`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
        }
    }

    return (
        <div className="min-h-screen flex flex-col bg-background">
            <Header />

            {/* Playground Header */}
            <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="container py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                            <div className="flex items-center space-x-2">
                                <Code2 className="h-6 w-6 text-primary" />
                                <h1 className="text-2xl font-bold">Playground</h1>
                                <Badge variant="secondary">Beta</Badge>
                            </div>

                            {/* Provider Selection */}
                            <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                                <SelectTrigger className="w-48">
                                    <SelectValue placeholder="Select AI Provider" />
                                </SelectTrigger>
                                <SelectContent>
                                    {providers.map((provider) => (
                                        <SelectItem key={provider.id} value={provider.id}>
                                            <div className="flex items-center space-x-2">
                                                <span>{provider.icon}</span>
                                                <span>{provider.name}</span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center space-x-2">
                            <Button variant="outline" size="sm" onClick={handleLoad}>
                                <Upload className="h-4 w-4 mr-2" />
                                Load
                            </Button>
                            <Button variant="outline" size="sm" onClick={handleSave}>
                                <Save className="h-4 w-4 mr-2" />
                                Save
                            </Button>
                            <Button variant="outline" size="sm" onClick={handleExport}>
                                <Download className="h-4 w-4 mr-2" />
                                Export
                            </Button>
                            <Button
                                onClick={handleRun}
                                disabled={isRunning || !code.trim()}
                                className="bg-primary hover:bg-primary/90"
                            >
                                {isRunning ? (
                                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                    <Play className="h-4 w-4 mr-2" />
                                )}
                                {isRunning ? 'Running...' : 'Run'}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Playground Content */}
            <div className="flex-1 flex">
                {/* Left Panel - Code Editor */}
                <div className="flex-1 border-r">
                    <Tabs defaultValue="code" className="h-full flex flex-col">
                        <div className="border-b px-4">
                            <TabsList className="h-12">
                                <TabsTrigger value="code" className="flex items-center space-x-2">
                                    <Code2 className="h-4 w-4" />
                                    <span>Code Editor</span>
                                </TabsTrigger>
                                <TabsTrigger value="output" className="flex items-center space-x-2">
                                    <Terminal className="h-4 w-4" />
                                    <span>Output</span>
                                    {executionResult && (
                                        <Badge variant={executionResult.success ? "default" : "destructive"} className="ml-2 h-4">
                                            {executionResult.success ? '✓' : '✗'}
                                        </Badge>
                                    )}
                                </TabsTrigger>
                                <TabsTrigger value="config" className="flex items-center space-x-2">
                                    <Settings className="h-4 w-4" />
                                    <span>Configuration</span>
                                </TabsTrigger>
                            </TabsList>
                        </div>

                        <TabsContent value="code" className="flex-1 p-0 m-0">
                            <div className="h-full p-4">
                                <CodeEditor
                                    value={code}
                                    onChange={handleCodeChange}
                                    height="calc(100vh - 200px)"
                                />
                            </div>
                        </TabsContent>

                        <TabsContent value="output" className="flex-1 p-0 m-0">
                            <div className="h-full p-4">
                                <ExecutionOutput
                                    result={executionResult}
                                    isRunning={isRunning}
                                />
                            </div>
                        </TabsContent>

                        <TabsContent value="config" className="flex-1 p-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Agent Configuration</CardTitle>
                                    <CardDescription>
                                        Configure your agent settings and parameters
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Model</label>
                                            <Select defaultValue="gpt-4">
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="gpt-4">GPT-4</SelectItem>
                                                    <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                                                    <SelectItem value="claude-3">Claude 3</SelectItem>
                                                    <SelectItem value="gemini-pro">Gemini Pro</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Temperature</label>
                                            <Select defaultValue="0.7">
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="0">0.0 (Deterministic)</SelectItem>
                                                    <SelectItem value="0.3">0.3 (Focused)</SelectItem>
                                                    <SelectItem value="0.7">0.7 (Balanced)</SelectItem>
                                                    <SelectItem value="1.0">1.0 (Creative)</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </div>

                {/* Right Panel - Chat Interface */}
                <div className="w-96">
                    <ChatInterface
                        isAgentReady={isAgentReady}
                        onSendMessage={handleSendMessage}
                    />
                </div>
            </div>
        </div>
    )
} 