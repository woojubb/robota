'use client';

/**
 * AgentConfigurationBlock - Visual Agent Configuration Component
 * 
 * This component provides a visual block-coding style representation of
 * an Agent configuration in the Playground interface.
 * 
 * Features:
 * - Block-coding visual design
 * - Drag & drop capability
 * - Real-time configuration editing
 * - Tool and Plugin visualization
 * - AI Provider selection
 * - Live validation feedback
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Bot,
    Settings,
    Zap,
    Puzzle,
    Brain,
    Edit3,
    Copy,
    Trash2,
    Play,
    Pause,
    CheckCircle,
    AlertCircle,
    Info
} from 'lucide-react';
import type { PlaygroundAgentConfig } from '@/lib/playground/robota-executor';

export interface AgentConfigurationBlockProps {
    config: PlaygroundAgentConfig;
    isActive?: boolean;
    isExecuting?: boolean;
    onConfigChange: (config: PlaygroundAgentConfig) => void;
    onDuplicate?: (config: PlaygroundAgentConfig) => void;
    onDelete?: (config: PlaygroundAgentConfig) => void;
    onExecute?: (config: PlaygroundAgentConfig) => void;
    onPause?: () => void;
    className?: string;
    draggable?: boolean;
    onDragStart?: (event: React.DragEvent) => void;
    validationErrors?: string[];
}

export function AgentConfigurationBlock({
    config,
    isActive = false,
    isExecuting = false,
    onConfigChange,
    onDuplicate,
    onDelete,
    onExecute,
    onPause,
    className = '',
    draggable = false,
    onDragStart,
    validationErrors = []
}: AgentConfigurationBlockProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editedConfig, setEditedConfig] = useState<PlaygroundAgentConfig>(config);

    // Validation state
    const hasErrors = validationErrors.length > 0;
    const isValid = !hasErrors && editedConfig.name.trim().length > 0;

    // Status indicators
    const statusIcon = useMemo(() => {
        if (isExecuting) return <Play className="h-4 w-4 text-green-500 animate-pulse" />;
        if (hasErrors) return <AlertCircle className="h-4 w-4 text-red-500" />;
        if (isValid) return <CheckCircle className="h-4 w-4 text-green-500" />;
        return <Info className="h-4 w-4 text-gray-400" />;
    }, [isExecuting, hasErrors, isValid]);

    // Handle configuration updates
    const handleConfigUpdate = useCallback((updates: Partial<PlaygroundAgentConfig>) => {
        const newConfig = { ...editedConfig, ...updates };
        setEditedConfig(newConfig);

        if (!isEditing) {
            onConfigChange(newConfig);
        }
    }, [editedConfig, isEditing, onConfigChange]);

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

    // AI Provider configuration
    const handleProviderUpdate = useCallback((field: string, value: string | number) => {
        handleConfigUpdate({
            defaultModel: {
                ...editedConfig.defaultModel,
                [field]: value
            }
        });
    }, [editedConfig.defaultModel, handleConfigUpdate]);

    return (
        <Card
            className={`
        relative transition-all duration-200 border-2
        ${isActive ? 'border-blue-500 shadow-lg' : 'border-gray-200 hover:border-gray-300'}
        ${isExecuting ? 'bg-green-50 border-green-300' : ''}
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
                        <Bot className="h-5 w-5 text-blue-600" />
                        {isEditing ? (
                            <Input
                                value={editedConfig.name}
                                onChange={(e) => handleConfigUpdate({ name: e.target.value })}
                                className="h-6 text-sm font-semibold"
                                placeholder="Agent Name"
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
                                variant="outline"
                                onClick={onPause}
                                className="h-7 w-7 p-0"
                            >
                                <Pause className="h-3 w-3" />
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onExecute?.(config)}
                                disabled={!isValid}
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
                        {editedConfig.defaultModel.provider}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                        {editedConfig.defaultModel.model}
                    </Badge>
                    {editedConfig.tools && editedConfig.tools.length > 0 && (
                        <Badge variant="secondary" className="text-xs">
                            {editedConfig.tools.length} tools
                        </Badge>
                    )}
                    {editedConfig.plugins && editedConfig.plugins.length > 0 && (
                        <Badge variant="secondary" className="text-xs">
                            {editedConfig.plugins.length} plugins
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
                <Tabs defaultValue="model" className="w-full">
                    <TabsList className="grid w-full grid-cols-4 text-xs">
                        <TabsTrigger value="model" className="flex items-center gap-1">
                            <Brain className="h-3 w-3" />
                            Model
                        </TabsTrigger>
                        <TabsTrigger value="tools" className="flex items-center gap-1">
                            <Zap className="h-3 w-3" />
                            Tools
                        </TabsTrigger>
                        <TabsTrigger value="plugins" className="flex items-center gap-1">
                            <Puzzle className="h-3 w-3" />
                            Plugins
                        </TabsTrigger>
                        <TabsTrigger value="settings" className="flex items-center gap-1">
                            <Settings className="h-3 w-3" />
                            Settings
                        </TabsTrigger>
                    </TabsList>

                    {/* Model Configuration */}
                    <TabsContent value="model" className="space-y-3 mt-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs">Provider</Label>
                                <Select
                                    value={editedConfig.defaultModel.provider}
                                    onValueChange={(value) => handleProviderUpdate('provider', value)}
                                    disabled={!isEditing}
                                >
                                    <SelectTrigger className="h-8 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="openai">OpenAI</SelectItem>
                                        <SelectItem value="anthropic">Anthropic</SelectItem>
                                        <SelectItem value="google">Google</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1">
                                <Label className="text-xs">Model</Label>
                                <Select
                                    value={editedConfig.defaultModel.model}
                                    onValueChange={(value) => handleProviderUpdate('model', value)}
                                    disabled={!isEditing}
                                >
                                    <SelectTrigger className="h-8 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {editedConfig.defaultModel.provider === 'openai' && (
                                            <>
                                                <SelectItem value="gpt-4">GPT-4</SelectItem>
                                                <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                                                <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
                                            </>
                                        )}
                                        {editedConfig.defaultModel.provider === 'anthropic' && (
                                            <>
                                                <SelectItem value="claude-3-opus">Claude 3 Opus</SelectItem>
                                                <SelectItem value="claude-3-sonnet">Claude 3 Sonnet</SelectItem>
                                                <SelectItem value="claude-3-haiku">Claude 3 Haiku</SelectItem>
                                            </>
                                        )}
                                        {editedConfig.defaultModel.provider === 'google' && (
                                            <>
                                                <SelectItem value="gemini-pro">Gemini Pro</SelectItem>
                                                <SelectItem value="gemini-pro-vision">Gemini Pro Vision</SelectItem>
                                            </>
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs">Temperature</Label>
                                <span className="text-xs text-gray-500">
                                    {editedConfig.defaultModel.temperature || 0.7}
                                </span>
                            </div>
                            <input
                                type="range"
                                value={editedConfig.defaultModel.temperature || 0.7}
                                onChange={(e) => handleProviderUpdate('temperature', parseFloat(e.target.value))}
                                max={2}
                                min={0}
                                step={0.1}
                                disabled={!isEditing}
                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs">Max Tokens</Label>
                                <span className="text-xs text-gray-500">
                                    {editedConfig.defaultModel.maxTokens || 2000}
                                </span>
                            </div>
                            <input
                                type="range"
                                value={editedConfig.defaultModel.maxTokens || 2000}
                                onChange={(e) => handleProviderUpdate('maxTokens', parseInt(e.target.value))}
                                max={4000}
                                min={100}
                                step={100}
                                disabled={!isEditing}
                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>

                        <div className="space-y-1">
                            <Label className="text-xs">System Message</Label>
                            <Textarea
                                value={editedConfig.defaultModel.systemMessage || ''}
                                onChange={(e) => handleProviderUpdate('systemMessage', e.target.value)}
                                placeholder="You are a helpful AI assistant..."
                                className="min-h-[60px] text-xs resize-none"
                                disabled={!isEditing}
                            />
                        </div>
                    </TabsContent>

                    {/* Tools Configuration */}
                    <TabsContent value="tools" className="space-y-3 mt-3">
                        <div className="text-center py-4 text-xs text-gray-500">
                            <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p>Tools configuration will be implemented in ToolContainerBlock</p>
                            <div className="mt-2">
                                {editedConfig.tools && editedConfig.tools.length > 0 ? (
                                    <p>{editedConfig.tools.length} tools configured</p>
                                ) : (
                                    <p>No tools configured</p>
                                )}
                            </div>
                        </div>
                    </TabsContent>

                    {/* Plugins Configuration */}
                    <TabsContent value="plugins" className="space-y-3 mt-3">
                        <div className="text-center py-4 text-xs text-gray-500">
                            <Puzzle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p>Plugins configuration will be implemented in PluginContainerBlock</p>
                            <div className="mt-2">
                                {editedConfig.plugins && editedConfig.plugins.length > 0 ? (
                                    <p>{editedConfig.plugins.length} plugins configured</p>
                                ) : (
                                    <p>No plugins configured</p>
                                )}
                            </div>
                        </div>
                    </TabsContent>

                    {/* Advanced Settings */}
                    <TabsContent value="settings" className="space-y-3 mt-3">
                        <div className="space-y-3">
                            <div className="space-y-1">
                                <Label className="text-xs">Agent ID</Label>
                                <Input
                                    value={editedConfig.id || ''}
                                    onChange={(e) => handleConfigUpdate({ id: e.target.value })}
                                    placeholder="Auto-generated if empty"
                                    className="h-8 text-xs"
                                    disabled={!isEditing}
                                />
                            </div>

                            {editedConfig.metadata && (
                                <div className="space-y-1">
                                    <Label className="text-xs">Metadata</Label>
                                    <div className="p-2 bg-gray-50 rounded text-xs">
                                        <pre className="whitespace-pre-wrap text-gray-600">
                                            {JSON.stringify(editedConfig.metadata, null, 2)}
                                        </pre>
                                    </div>
                                </div>
                            )}
                        </div>
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
} 