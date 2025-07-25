'use client';

/**
 * TeamConfigurationBlock - Visual Team Configuration Component
 * 
 * This component provides a visual block-coding style representation of
 * a Team configuration in the Playground interface.
 * 
 * Features:
 * - Team workflow visualization
 * - Agent container management
 * - Coordinator configuration
 * - Team-level settings and validation
 * - Drag & drop for agent ordering
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Users,
    Plus,
    Settings,
    Workflow,
    Bot,
    GitBranch,
    ArrowRight,
    ArrowDown,
    Edit3,
    Copy,
    Trash2,
    Play,
    Pause,
    CheckCircle,
    AlertCircle,
    Info,
    RotateCcw,
    Target,
    Timer,
    UserPlus
} from 'lucide-react';
import type { PlaygroundTeamConfig, PlaygroundAgentConfig } from '@/lib/playground/robota-executor';
import { AgentConfigurationBlock } from './agent-configuration-block';

export interface TeamConfigurationBlockProps {
    config: PlaygroundTeamConfig;
    isActive?: boolean;
    isExecuting?: boolean;
    onConfigChange: (config: PlaygroundTeamConfig) => void;
    onDuplicate?: (config: PlaygroundTeamConfig) => void;
    onDelete?: (config: PlaygroundTeamConfig) => void;
    onExecute?: (config: PlaygroundTeamConfig) => void;
    onStop?: () => void; // Added onStop prop
    onPause?: () => void;
    className?: string;
    draggable?: boolean;
    onDragStart?: (event: React.DragEvent) => void;
    validationErrors?: string[];
}

const COORDINATOR_STRATEGIES = [
    {
        value: 'round-robin',
        label: 'Round Robin',
        description: 'Agents take turns in order'
    },
    {
        value: 'priority',
        label: 'Priority Based',
        description: 'Agents execute based on priority'
    },
    {
        value: 'capability',
        label: 'Capability Matching',
        description: 'Best agent for each task'
    },
    {
        value: 'parallel',
        label: 'Parallel Execution',
        description: 'All agents execute simultaneously'
    },
    {
        value: 'consensus',
        label: 'Consensus',
        description: 'Agents vote on decisions'
    }
];

function WorkflowVisualization({
    agents,
    coordinator,
    isExecuting = false
}: {
    agents: PlaygroundAgentConfig[];
    coordinator?: string;
    isExecuting?: boolean;
}) {
    const getFlowDirection = () => {
        switch (coordinator) {
            case 'round-robin':
                return 'sequential';
            case 'parallel':
                return 'parallel';
            case 'consensus':
                return 'convergent';
            default:
                return 'sequential';
        }
    };

    const flowDirection = getFlowDirection();

    return (
        <div className="p-3 bg-gray-50 rounded-lg border">
            <div className="flex items-center gap-2 mb-3">
                <Workflow className="h-4 w-4 text-blue-600" />
                <Label className="text-xs font-medium">Team Workflow</Label>
                <Badge variant="outline" className="text-xs">
                    {coordinator || 'round-robin'}
                </Badge>
            </div>

            <div className="space-y-2">
                {flowDirection === 'parallel' ? (
                    // Parallel workflow
                    <div className="flex flex-col items-center space-y-2">
                        <div className="w-full text-center">
                            <div className="inline-flex items-center gap-2 px-2 py-1 bg-blue-100 rounded text-xs">
                                <Target className="h-3 w-3" />
                                Input
                            </div>
                        </div>

                        <div className="flex items-center justify-center">
                            <ArrowDown className="h-4 w-4 text-gray-400" />
                        </div>

                        <div className="grid grid-cols-2 gap-2 w-full">
                            {agents.slice(0, 4).map((agent, index) => (
                                <div
                                    key={index}
                                    className={`
                    flex items-center gap-1 px-2 py-1 rounded text-xs border
                    ${isExecuting ? 'bg-green-100 border-green-300 animate-pulse' : 'bg-white border-gray-200'}
                  `}
                                >
                                    <Bot className="h-3 w-3" />
                                    <span className="truncate">{agent.name}</span>
                                </div>
                            ))}
                        </div>

                        <div className="flex items-center justify-center">
                            <ArrowDown className="h-4 w-4 text-gray-400" />
                        </div>

                        <div className="w-full text-center">
                            <div className="inline-flex items-center gap-2 px-2 py-1 bg-green-100 rounded text-xs">
                                <CheckCircle className="h-3 w-3" />
                                Output
                            </div>
                        </div>
                    </div>
                ) : flowDirection === 'convergent' ? (
                    // Consensus workflow
                    <div className="flex flex-col items-center space-y-2">
                        <div className="w-full text-center">
                            <div className="inline-flex items-center gap-2 px-2 py-1 bg-blue-100 rounded text-xs">
                                <Target className="h-3 w-3" />
                                Input
                            </div>
                        </div>

                        <div className="flex items-center justify-center">
                            <ArrowDown className="h-4 w-4 text-gray-400" />
                        </div>

                        <div className="grid grid-cols-2 gap-2 w-full">
                            {agents.slice(0, 4).map((agent, index) => (
                                <div
                                    key={index}
                                    className={`
                    flex items-center gap-1 px-2 py-1 rounded text-xs border
                    ${isExecuting ? 'bg-blue-100 border-blue-300' : 'bg-white border-gray-200'}
                  `}
                                >
                                    <Bot className="h-3 w-3" />
                                    <span className="truncate">{agent.name}</span>
                                </div>
                            ))}
                        </div>

                        <div className="flex items-center justify-center">
                            <RotateCcw className="h-4 w-4 text-purple-400" />
                        </div>

                        <div className="w-full text-center">
                            <div className="inline-flex items-center gap-2 px-2 py-1 bg-purple-100 rounded text-xs">
                                <Users className="h-3 w-3" />
                                Consensus
                            </div>
                        </div>

                        <div className="flex items-center justify-center">
                            <ArrowDown className="h-4 w-4 text-gray-400" />
                        </div>

                        <div className="w-full text-center">
                            <div className="inline-flex items-center gap-2 px-2 py-1 bg-green-100 rounded text-xs">
                                <CheckCircle className="h-3 w-3" />
                                Output
                            </div>
                        </div>
                    </div>
                ) : (
                    // Sequential workflow (round-robin, priority, capability)
                    <div className="flex flex-col items-center space-y-1">
                        <div className="w-full text-center">
                            <div className="inline-flex items-center gap-2 px-2 py-1 bg-blue-100 rounded text-xs">
                                <Target className="h-3 w-3" />
                                Input
                            </div>
                        </div>

                        {agents.slice(0, 3).map((agent, index) => (
                            <React.Fragment key={index}>
                                <div className="flex items-center justify-center">
                                    <ArrowDown className="h-3 w-3 text-gray-400" />
                                </div>
                                <div
                                    className={`
                    flex items-center gap-2 px-3 py-1 rounded text-xs border w-full max-w-xs
                    ${isExecuting && index === 0 ? 'bg-green-100 border-green-300 animate-pulse' : 'bg-white border-gray-200'}
                  `}
                                >
                                    <Bot className="h-3 w-3" />
                                    <span className="truncate flex-1">{agent.name}</span>
                                    {coordinator === 'priority' && (
                                        <Badge variant="outline" className="text-xs px-1 py-0">
                                            P{index + 1}
                                        </Badge>
                                    )}
                                </div>
                            </React.Fragment>
                        ))}

                        {agents.length > 3 && (
                            <>
                                <div className="flex items-center justify-center">
                                    <ArrowDown className="h-3 w-3 text-gray-400" />
                                </div>
                                <div className="text-xs text-gray-500">
                                    +{agents.length - 3} more agents
                                </div>
                            </>
                        )}

                        <div className="flex items-center justify-center">
                            <ArrowDown className="h-3 w-3 text-gray-400" />
                        </div>

                        <div className="w-full text-center">
                            <div className="inline-flex items-center gap-2 px-2 py-1 bg-green-100 rounded text-xs">
                                <CheckCircle className="h-3 w-3" />
                                Output
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export function TeamConfigurationBlock({
    config,
    isActive = false,
    isExecuting = false,
    onConfigChange,
    onDuplicate,
    onDelete,
    onExecute,
    onStop,
    onPause,
    className = '',
    draggable = false,
    onDragStart,
    validationErrors = []
}: TeamConfigurationBlockProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editedConfig, setEditedConfig] = useState<PlaygroundTeamConfig>(config);
    const [activeTab, setActiveTab] = useState('overview');

    // Validation state
    const hasErrors = validationErrors.length > 0;
    const isValid = !hasErrors && editedConfig.name.trim().length > 0 && editedConfig.agents.length > 0;

    // Status indicators
    const statusIcon = useMemo(() => {
        if (isExecuting) return <Play className="h-4 w-4 text-green-500 animate-pulse" />;
        if (hasErrors) return <AlertCircle className="h-4 w-4 text-red-500" />;
        if (isValid) return <CheckCircle className="h-4 w-4 text-green-500" />;
        return <Info className="h-4 w-4 text-gray-400" />;
    }, [isExecuting, hasErrors, isValid]);

    // Handle configuration updates
    const handleConfigUpdate = useCallback((updates: Partial<PlaygroundTeamConfig>) => {
        const newConfig = { ...editedConfig, ...updates };
        setEditedConfig(newConfig);

        if (!isEditing) {
            onConfigChange(newConfig);
        }
    }, [editedConfig, isEditing, onConfigChange]);

    // Handle workflow updates
    const handleWorkflowUpdate = useCallback((field: string, value: string | number) => {
        handleConfigUpdate({
            workflow: {
                ...editedConfig.workflow,
                [field]: value
            }
        });
    }, [editedConfig.workflow, handleConfigUpdate]);

    // Handle agent updates
    const handleAgentUpdate = useCallback((index: number, updatedAgent: PlaygroundAgentConfig) => {
        const newAgents = [...editedConfig.agents];
        newAgents[index] = updatedAgent;
        handleConfigUpdate({ agents: newAgents });
    }, [editedConfig.agents, handleConfigUpdate]);

    // Handle agent removal
    const handleAgentRemove = useCallback((index: number) => {
        const newAgents = editedConfig.agents.filter((_, i) => i !== index);
        handleConfigUpdate({ agents: newAgents });
    }, [editedConfig.agents, handleConfigUpdate]);

    // Add new agent
    const handleAddAgent = useCallback(() => {
        const newAgent: PlaygroundAgentConfig = {
            name: `Agent ${editedConfig.agents.length + 1}`,
            aiProviders: [],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-4',
                temperature: 0.7,
                maxTokens: 2000,
                systemMessage: 'You are a helpful AI assistant.'
            },
            tools: [],
            plugins: [],
            metadata: {
                createdAt: new Date().toISOString(),
                version: '1.0.0'
            }
        };

        const newAgents = [...editedConfig.agents, newAgent];
        handleConfigUpdate({ agents: newAgents });
    }, [editedConfig.agents, handleConfigUpdate]);

    // Save edited configuration
    const handleSave = useCallback(() => {
        onConfigChange(editedConfig);
        setIsEditing(false);
    }, [editedConfig, onConfigChange]);

    // Cancel editing
    const handleCancel = useCallback(() => {
        setEditedConfig(config);
        setIsEditing(false);
    }, [config]);

    return (
        <Card
            className={`
        relative transition-all duration-200 border-2
        ${isActive ? 'border-purple-500 shadow-lg' : 'border-gray-200 hover:border-gray-300'}
        ${isExecuting ? 'bg-purple-50 border-purple-300' : ''}
        ${hasErrors ? 'border-red-300 bg-red-50' : ''}
        ${draggable ? 'cursor-move' : ''}
        ${className}
      `}
            draggable={draggable}
            onDragStart={onDragStart}
        >
            {/* Header */}
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-purple-600" />
                        {isEditing ? (
                            <Input
                                value={editedConfig.name}
                                onChange={(e) => handleConfigUpdate({ name: e.target.value })}
                                className="h-6 text-sm font-semibold"
                                placeholder="Team Name"
                            />
                        ) : (
                            <CardTitle className="text-sm font-semibold">
                                {config.name}
                            </CardTitle>
                        )}
                        {statusIcon}
                    </div>

                    <div className="flex items-center gap-1">
                        {/* Action Buttons */}
                        {isExecuting ? (
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={onStop}
                                className="h-7 w-7 p-0"
                            >
                                <Pause className="h-3 w-3" />
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onExecute?.(config)}
                                disabled={!isValid || isExecuting}
                                className="h-7 w-7 p-0"
                            >
                                <Play className="h-3 w-3" />
                            </Button>
                        )}

                        {isEditing ? (
                            <>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={handleSave}
                                    className="h-7 px-2 text-xs"
                                >
                                    Save
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={handleCancel}
                                    className="h-7 px-2 text-xs"
                                >
                                    Cancel
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setIsEditing(true)}
                                    className="h-7 w-7 p-0"
                                >
                                    <Edit3 className="h-3 w-3" />
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => onDuplicate?.(config)}
                                    className="h-7 w-7 p-0"
                                >
                                    <Copy className="h-3 w-3" />
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => onDelete?.(config)}
                                    className="h-7 w-7 p-0 text-red-500"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {/* Status Bar */}
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Badge variant="outline" className="text-xs">
                        {editedConfig.agents.length} agents
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                        {editedConfig.workflow?.coordinator || 'round-robin'}
                    </Badge>
                    {editedConfig.workflow?.maxDepth && (
                        <Badge variant="secondary" className="text-xs">
                            Max depth: {editedConfig.workflow.maxDepth}
                        </Badge>
                    )}
                </div>

                {/* Validation Errors */}
                {validationErrors.length > 0 && (
                    <div className="mt-2 p-2 bg-red-100 border border-red-200 rounded text-xs text-red-700">
                        <ul className="list-disc list-inside space-y-1">
                            {validationErrors.map((error, index) => (
                                <li key={index}>{error}</li>
                            ))}
                        </ul>
                    </div>
                )}
            </CardHeader>

            {/* Content */}
            <CardContent className="pt-0">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-3 text-xs">
                        <TabsTrigger value="overview" className="flex items-center gap-1">
                            <Workflow className="h-3 w-3" />
                            Overview
                        </TabsTrigger>
                        <TabsTrigger value="agents" className="flex items-center gap-1">
                            <Bot className="h-3 w-3" />
                            Agents
                        </TabsTrigger>
                        <TabsTrigger value="settings" className="flex items-center gap-1">
                            <Settings className="h-3 w-3" />
                            Settings
                        </TabsTrigger>
                    </TabsList>

                    {/* Overview Tab */}
                    <TabsContent value="overview" className="space-y-3 mt-3">
                        <WorkflowVisualization
                            agents={editedConfig.agents}
                            coordinator={editedConfig.workflow?.coordinator}
                            isExecuting={isExecuting}
                        />

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs">Coordinator Strategy</Label>
                                <Select
                                    value={editedConfig.workflow?.coordinator || 'round-robin'}
                                    onValueChange={(value) => handleWorkflowUpdate('coordinator', value)}
                                    disabled={!isEditing}
                                >
                                    <SelectTrigger className="h-8 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {COORDINATOR_STRATEGIES.map((strategy) => (
                                            <SelectItem key={strategy.value} value={strategy.value}>
                                                <div>
                                                    <div className="font-medium">{strategy.label}</div>
                                                    <div className="text-xs text-gray-500">{strategy.description}</div>
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1">
                                <Label className="text-xs">Max Execution Depth</Label>
                                <Input
                                    type="number"
                                    value={editedConfig.workflow?.maxDepth || 3}
                                    onChange={(e) => handleWorkflowUpdate('maxDepth', parseInt(e.target.value))}
                                    placeholder="3"
                                    className="h-8 text-xs"
                                    disabled={!isEditing}
                                    min={1}
                                    max={10}
                                />
                            </div>
                        </div>
                    </TabsContent>

                    {/* Agents Tab */}
                    <TabsContent value="agents" className="space-y-3 mt-3">
                        <div className="flex items-center justify-between">
                            <Label className="text-xs font-medium">Team Agents ({editedConfig.agents.length})</Label>
                            {isEditing && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={handleAddAgent}
                                    className="h-7 px-2 text-xs"
                                >
                                    <UserPlus className="h-3 w-3 mr-1" />
                                    Add Agent
                                </Button>
                            )}
                        </div>

                        {editedConfig.agents.length === 0 ? (
                            <div className="text-center py-6 text-xs text-gray-500">
                                <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                <p>No agents in this team</p>
                                {isEditing && (
                                    <p className="mt-1">Click "Add Agent" to get started</p>
                                )}
                            </div>
                        ) : (
                            <ScrollArea className="max-h-96 w-full">
                                <div className="space-y-3">
                                    {editedConfig.agents.map((agent, index) => (
                                        <div key={index} className="relative">
                                            <AgentConfigurationBlock
                                                config={agent}
                                                onConfigChange={(updatedAgent) => handleAgentUpdate(index, updatedAgent)}
                                                onDelete={isEditing ? () => handleAgentRemove(index) : undefined}
                                                className="text-xs"
                                                validationErrors={[]}
                                            />
                                            {index < editedConfig.agents.length - 1 && (
                                                <div className="flex justify-center py-1">
                                                    <ArrowDown className="h-3 w-3 text-gray-400" />
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        )}
                    </TabsContent>

                    {/* Settings Tab */}
                    <TabsContent value="settings" className="space-y-3 mt-3">
                        <div className="space-y-3">
                            <div className="space-y-1">
                                <Label className="text-xs">Team Description</Label>
                                <Textarea
                                    value={(editedConfig as unknown as { description?: string }).description || ''}
                                    onChange={(e) => handleConfigUpdate({ description: e.target.value } as Partial<PlaygroundTeamConfig>)}
                                    placeholder="Describe the purpose of this team..."
                                    className="min-h-[60px] text-xs resize-none"
                                    disabled={!isEditing}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <Label className="text-xs">Execution Timeout (seconds)</Label>
                                    <Input
                                        type="number"
                                        value={(editedConfig.workflow as unknown as { timeout?: number })?.timeout || 300}
                                        onChange={(e) => handleWorkflowUpdate('timeout', parseInt(e.target.value))}
                                        placeholder="300"
                                        className="h-8 text-xs"
                                        disabled={!isEditing}
                                        min={30}
                                        max={3600}
                                    />
                                </div>

                                <div className="space-y-1">
                                    <Label className="text-xs">Retry Attempts</Label>
                                    <Input
                                        type="number"
                                        value={(editedConfig.workflow as unknown as { retries?: number })?.retries || 3}
                                        onChange={(e) => handleWorkflowUpdate('retries', parseInt(e.target.value))}
                                        placeholder="3"
                                        className="h-8 text-xs"
                                        disabled={!isEditing}
                                        min={0}
                                        max={10}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={(editedConfig.workflow as unknown as { enableLogging?: boolean })?.enableLogging !== false}
                                        onCheckedChange={(checked) => handleWorkflowUpdate('enableLogging', checked)}
                                        disabled={!isEditing}
                                    />
                                    <Label className="text-xs">Enable Team Logging</Label>
                                </div>

                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={(editedConfig.workflow as unknown as { enableMetrics?: boolean })?.enableMetrics !== false}
                                        onCheckedChange={(checked) => handleWorkflowUpdate('enableMetrics', checked)}
                                        disabled={!isEditing}
                                    />
                                    <Label className="text-xs">Enable Performance Metrics</Label>
                                </div>
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
} 