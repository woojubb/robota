'use client'

import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Play, Save, Download, FolderOpen, Sparkles, Keyboard } from 'lucide-react';

import { CodeEditor, exampleTemplates } from '@/components/playground/code-editor';
import { ChatInterface } from '@/components/playground/chat-interface';
import { ExecutionOutput } from '@/components/playground/execution-output';
import { ProjectBrowser } from '@/components/playground/project-browser';
import { TemplateGallery } from '@/components/playground/template-gallery';
import { ShortcutsHelp } from '@/components/playground/shortcuts-help';
import { ProjectManager, type Project } from '@/lib/playground/project-manager';
import { CodeExecutor, type ExecutionResult } from '@/lib/playground/code-executor';
import { useToast } from '../../hooks/use-toast';
import { useKeyboardShortcuts, createShortcuts } from '../../hooks/use-keyboard-shortcuts';

type Provider = 'openai' | 'anthropic' | 'google';

interface PlaygroundState {
    code: string;
    provider: Provider;
    model: string;
    temperature: number;
}

const models = {
    openai: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    anthropic: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
    google: ['gemini-pro', 'gemini-pro-vision'],
};

export default function PlaygroundPage() {
    const [activeTab, setActiveTab] = useState<'editor' | 'projects' | 'templates'>('editor');
    const [currentProject, setCurrentProject] = useState<Project | null>(null);
    const [state, setState] = useState<PlaygroundState>({
        code: exampleTemplates.basic.code,
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        temperature: 0.7
    });

    const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
    const [isExecuting, setIsExecuting] = useState(false);

    const { toast } = useToast();

    // Load current project on mount
    useEffect(() => {
        const savedProjectId = localStorage.getItem('robota-current-project');
        if (savedProjectId) {
            const project = ProjectManager.getInstance().loadProject(savedProjectId);
            if (project) {
                setCurrentProject(project);
                setState(prev => ({
                    ...prev,
                    code: project.code,
                    provider: project.provider as Provider,
                    model: project.config.model,
                    temperature: parseFloat(project.config.temperature) || 0.7
                }));
            }
        }
    }, []);

    const handleSelectProject = useCallback((project: Project) => {
        setCurrentProject(project);
        setState(prev => ({
            ...prev,
            code: project.code,
            provider: project.provider as Provider,
            model: project.config.model,
            temperature: parseFloat(project.config.temperature) || 0.7
        }));

        // Save current project ID
        localStorage.setItem('robota-current-project', project.id);

        // Switch to editor tab
        setActiveTab('editor');

        toast({
            title: "Project Loaded",
            description: `"${project.name}" has been loaded successfully`
        });
    }, [toast]);

    const handleCreateNewProject = useCallback(() => {
        // Switch to editor tab and reset state
        setActiveTab('editor');
        setCurrentProject(null);
        setState({
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
            model: 'gpt-4',
            temperature: 0.7
        });

        localStorage.removeItem('robota-current-project');

        toast({
            title: "New Project",
            description: "Started with a clean slate"
        });
    }, [toast]);

    const handleCodeChange = useCallback((newCode: string | undefined) => {
        const code = newCode || '';
        setState(prev => ({ ...prev, code }));

        // Auto-save current project if it exists
        if (currentProject) {
            ProjectManager.getInstance().updateProject(currentProject.id, {
                code,
                config: {
                    model: state.model,
                    temperature: state.temperature.toString(),
                    provider: state.provider
                }
            });
        }
    }, [currentProject, state.model, state.temperature, state.provider]);

    const handleProviderChange = useCallback((provider: Provider) => {
        setState(prev => ({
            ...prev,
            provider,
            model: models[provider][0]
        }));
    }, []);

    const handleModelChange = useCallback((model: string) => {
        setState(prev => ({ ...prev, model }));
    }, []);

    const handleTemperatureChange = useCallback((temperature: number) => {
        setState(prev => ({ ...prev, temperature }));
    }, []);

    const handleExecute = useCallback(async () => {
        setIsExecuting(true);
        try {
            const executor = new CodeExecutor();
            const result = await executor.executeCode(state.code, state.provider);
            setExecutionResult(result);
        } catch (error) {
            setExecutionResult({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred',
                logs: [`Error: ${error instanceof Error ? error.message : 'Unknown error'}`],
                duration: 0,
                agentReady: false
            });
        } finally {
            setIsExecuting(false);
        }
    }, [state]);

    const handleSaveProject = useCallback(() => {
        if (currentProject) {
            // Update existing project
            ProjectManager.getInstance().updateProject(currentProject.id, {
                code: state.code,
                config: {
                    model: state.model,
                    temperature: state.temperature.toString(),
                    provider: state.provider
                }
            });

            toast({
                title: "Project Saved",
                description: `"${currentProject.name}" has been updated`
            });
        } else {
            // Save as new project
            const projectName = `Project ${new Date().toLocaleDateString()}`;
            const project = ProjectManager.getInstance().createProject(
                projectName,
                'Created from playground',
                {
                    provider: state.provider,
                    model: state.model,
                    temperature: state.temperature.toString()
                }
            );

            // Update with current code
            ProjectManager.getInstance().updateProject(project.id, {
                code: state.code
            });

            setCurrentProject(project);
            localStorage.setItem('robota-current-project', project.id);

            toast({
                title: "Project Saved",
                description: `New project "${projectName}" has been created`
            });
        }
    }, [currentProject, state, toast]);

    const handleExportProject = useCallback(() => {
        const projectData = {
            name: currentProject?.name || 'Playground Export',
            description: currentProject?.description || 'Exported from playground',
            code: state.code,
            provider: state.provider,
            config: {
                model: state.model,
                temperature: state.temperature.toString()
            }
        };

        const dataStr = JSON.stringify(projectData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${projectData.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
        link.click();
        URL.revokeObjectURL(url);

        toast({
            title: "Project Exported",
            description: "Project has been downloaded as JSON"
        });
    }, [currentProject, state, toast]);

    const handleSendMessage = useCallback(async (message: string): Promise<string> => {
        // Simulate AI response based on execution result
        return new Promise((resolve) => {
            setTimeout(() => {
                let assistantResponse = "I understand your message. ";

                if (executionResult?.success && executionResult.agentReady) {
                    assistantResponse += "Your agent is configured and ready to help! ";
                    assistantResponse += "I'm running on " + state.provider + " with model " + state.model + ". ";
                    assistantResponse += "How can I assist you today?";
                } else if (executionResult?.error) {
                    assistantResponse += `There's an issue with your code: ${executionResult.error}. `;
                    assistantResponse += "Please fix the code and run it again.";
                } else {
                    assistantResponse += "Please run your code first to initialize the agent.";
                }

                resolve(assistantResponse);
            }, 1000);
        });
    }, [executionResult, state.provider, state.model]);

    const handleFixSuggestion = useCallback((suggestion: string) => {
        // For now, just show a toast with the suggestion
        // In a more advanced implementation, this could automatically apply the fix
        toast({
            title: "Fix Suggestion",
            description: suggestion
        });
    }, [toast]);

    const handleSelectTemplate = useCallback((template: any) => {
        // Update state with template
        setState(prev => ({
            ...prev,
            code: template.code,
            provider: template.provider as Provider,
            model: template.config.model,
            temperature: parseFloat(template.config.temperature) || 0.7
        }));

        // Clear current project since we're starting from template
        setCurrentProject(null);
        localStorage.removeItem('robota-current-project');

        // Switch to editor tab
        setActiveTab('editor');

        toast({
            title: "Template Loaded",
            description: `"${template.name}" template has been applied`
        });
    }, [toast]);

    const handleSwitchTab = useCallback((direction: 'next' | 'prev') => {
        const tabs: Array<'editor' | 'projects' | 'templates'> = ['editor', 'projects', 'templates'];
        const currentIndex = tabs.indexOf(activeTab);

        if (direction === 'next') {
            const nextIndex = (currentIndex + 1) % tabs.length;
            setActiveTab(tabs[nextIndex]);
        } else {
            const prevIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1;
            setActiveTab(tabs[prevIndex]);
        }
    }, [activeTab]);

    const handleTabShortcut = useCallback((tabNumber: number) => {
        const tabs: Array<'editor' | 'projects' | 'templates'> = ['editor', 'projects', 'templates'];
        if (tabNumber >= 1 && tabNumber <= tabs.length) {
            setActiveTab(tabs[tabNumber - 1]);
        }
    }, []);

    // Setup keyboard shortcuts
    const shortcuts = [
        createShortcuts.save(handleSaveProject),
        createShortcuts.run(handleExecute),
        createShortcuts.new(handleCreateNewProject),
        createShortcuts.open(() => setActiveTab('projects')),
        createShortcuts.export(handleExportProject),
        createShortcuts.templates(() => setActiveTab('templates')),
        createShortcuts.quickRun(handleExecute),
        ...createShortcuts.switchTab(handleSwitchTab),
        {
            key: 'F1',
            handler: () => {
                // F1 will be handled by the ShortcutsHelp component
                const helpButton = document.querySelector('[data-shortcuts-help]') as HTMLElement;
                helpButton?.click();
            },
            description: 'Show keyboard shortcuts'
        },
        {
            key: '1',
            alt: true,
            handler: () => handleTabShortcut(1),
            description: 'Switch to Editor tab'
        },
        {
            key: '2',
            alt: true,
            handler: () => handleTabShortcut(2),
            description: 'Switch to Projects tab'
        },
        {
            key: '3',
            alt: true,
            handler: () => handleTabShortcut(3),
            description: 'Switch to Templates tab'
        }
    ];

    useKeyboardShortcuts({
        shortcuts,
        enabled: true
    });

    return (
        <div className="container mx-auto py-8 px-4">
            <div className="mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold mb-2">Robota Playground</h1>
                        <p className="text-muted-foreground">
                            Build and test your Robota agents in an interactive environment
                        </p>
                    </div>
                    <div className="flex items-center space-x-2">
                        <ShortcutsHelp
                            trigger={
                                <Button variant="outline" size="sm" data-shortcuts-help>
                                    <Keyboard className="w-4 h-4 mr-2" />
                                    Shortcuts
                                </Button>
                            }
                        />
                    </div>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'editor' | 'projects' | 'templates')}>
                <TabsList className="mb-6">
                    <TabsTrigger value="editor" className="flex items-center space-x-2">
                        <span>Code Editor</span>
                        {currentProject && (
                            <Badge variant="secondary" className="ml-2 text-xs">
                                {currentProject.name}
                            </Badge>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="projects" className="flex items-center space-x-2">
                        <FolderOpen className="w-4 h-4" />
                        <span>Projects</span>
                    </TabsTrigger>
                    <TabsTrigger value="templates" className="flex items-center space-x-2">
                        <Sparkles className="w-4 h-4" />
                        <span>Templates</span>
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="editor" className="space-y-6">
                    {/* Settings Panel */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center justify-between">
                                <span>Agent Configuration</span>
                                <div className="flex space-x-2">
                                    <Button variant="outline" size="sm" onClick={handleSaveProject}>
                                        <Save className="w-4 h-4 mr-2" />
                                        {currentProject ? 'Save' : 'Save As New'}
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={handleExportProject}>
                                        <Download className="w-4 h-4 mr-2" />
                                        Export
                                    </Button>
                                    <Button size="sm" onClick={handleExecute} disabled={isExecuting}>
                                        <Play className="w-4 h-4 mr-2" />
                                        {isExecuting ? 'Running...' : 'Run Code'}
                                    </Button>
                                </div>
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {/* Example Template Selector */}
                                <div>
                                    <Label htmlFor="template">Example Template</Label>
                                    <Select onValueChange={(templateKey) => {
                                        const template = exampleTemplates[templateKey as keyof typeof exampleTemplates];
                                        if (template) {
                                            setState(prev => ({ ...prev, code: template.code }));
                                            toast({
                                                title: "Template Loaded",
                                                description: `${template.name} example has been loaded`
                                            });
                                        }
                                    }}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Choose an example template" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {Object.entries(exampleTemplates).map(([key, template]) => (
                                                <SelectItem key={key} value={key}>
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{template.name}</span>
                                                        <span className="text-xs text-muted-foreground">{template.description}</span>
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <Label htmlFor="provider">AI Provider</Label>
                                        <Select value={state.provider} onValueChange={handleProviderChange}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="openai">OpenAI</SelectItem>
                                                <SelectItem value="anthropic">Anthropic</SelectItem>
                                                <SelectItem value="google">Google</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div>
                                        <Label htmlFor="model">Model</Label>
                                        <Select value={state.model} onValueChange={handleModelChange}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {models[state.provider].map((model) => (
                                                    <SelectItem key={model} value={model}>
                                                        {model}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div>
                                        <Label htmlFor="temperature">Temperature</Label>
                                        <Input
                                            type="number"
                                            min="0"
                                            max="2"
                                            step="0.1"
                                            value={state.temperature}
                                            onChange={(e) => handleTemperatureChange(parseFloat(e.target.value))}
                                        />
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Main Content */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Code Editor */}
                        <Card className="lg:col-span-1">
                            <CardHeader>
                                <CardTitle>Code Editor</CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                <CodeEditor
                                    value={state.code}
                                    onChange={handleCodeChange}
                                    language="typescript"
                                    height="500px"
                                />
                            </CardContent>
                        </Card>

                        {/* Chat & Output */}
                        <div className="space-y-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Chat Interface</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <ChatInterface
                                        isAgentReady={Boolean(executionResult?.success && executionResult?.agentReady)}
                                        onSendMessage={handleSendMessage}
                                    />
                                </CardContent>
                            </Card>

                            {executionResult && (
                                <ExecutionOutput
                                    result={executionResult}
                                    isRunning={isExecuting}
                                    onFixSuggestion={handleFixSuggestion}
                                />
                            )}
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="projects">
                    <ProjectBrowser
                        onSelectProject={handleSelectProject}
                        onCreateNew={handleCreateNewProject}
                        currentProjectId={currentProject?.id}
                    />
                </TabsContent>

                <TabsContent value="templates">
                    <TemplateGallery
                        onSelectTemplate={handleSelectTemplate}
                        onClose={() => setActiveTab('editor')}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
} 