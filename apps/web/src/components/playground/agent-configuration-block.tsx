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
 * - Play/Stop execution control
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
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
    Copy,
    Trash2,
    Play,
    Square,
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
    onExecute?: (config: PlaygroundAgentConfig) => void;
    onStop?: () => void;
    onDuplicate?: (config: PlaygroundAgentConfig) => void;
    onDelete?: (config: PlaygroundAgentConfig) => void;
    className?: string;
}

/**
 * Visual Agent Configuration Block Component
 */
export function AgentConfigurationBlock({
    config,
    isActive = false,
    isExecuting = false,
    onConfigChange,
    onExecute,
    onStop,
    onDuplicate,
    onDelete,
    className = ''
}: AgentConfigurationBlockProps) {
    // Configuration state - always editable when not executing
    const [editedConfig, setEditedConfig] = useState<PlaygroundAgentConfig>(config);

    // Validation state
    const validation = useMemo(() => {
        const errors: string[] = [];

        if (!editedConfig.name?.trim()) {
            errors.push('Agent name is required');
        }

        if (!editedConfig.defaultModel?.model) {
            errors.push('Model selection is required');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }, [editedConfig]);

    const { isValid } = validation;

    // Auto-save configuration changes when not executing
    const handleConfigUpdate = useCallback((updates: Partial<PlaygroundAgentConfig>) => {
        if (isExecuting) return; // Prevent changes during execution

        const newConfig = { ...editedConfig, ...updates };
        setEditedConfig(newConfig);

        // Auto-save changes
        onConfigChange(newConfig);
    }, [editedConfig, isExecuting, onConfigChange]);

    // Sync props with state on mount
    useEffect(() => {
        setEditedConfig(config);
    }, [config]);

    // Status indicators
    const statusIcon = useMemo(() => {
        if (isExecuting) {
            return <Badge variant="default" className="text-xs">Running</Badge>;
        }
        if (isActive) {
            return <CheckCircle className="h-4 w-4 text-green-500" />;
        }
        if (!isValid) {
            return <AlertCircle className="h-4 w-4 text-red-500" />;
        }
        return <Info className="h-4 w-4 text-blue-500" />;
    }, [isActive, isValid, isExecuting]);

    return (
        <Card className={`
            border-2 transition-all duration-200 bg-white
            ${isActive ? 'border-blue-500 shadow-md' : 'border-gray-200'}
            ${isExecuting ? 'border-green-500 shadow-lg' : ''}
            ${!isValid ? 'border-red-200' : ''}
            ${className}
        `}>
            {/* Header */}
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Bot className="h-5 w-5 text-blue-600" />
                        <Input
                            value={editedConfig.name}
                            onChange={(e) => handleConfigUpdate({ name: e.target.value })}
                            className="h-6 text-sm font-semibold border-none p-0 focus-visible:ring-0"
                            placeholder="Agent Name"
                            disabled={isExecuting}
                        />
                        {statusIcon}
                    </div>

                    <div className="flex items-center gap-1">
                        {/* Play/Stop Button */}
                        {isExecuting ? (
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onStop?.();
                                }}
                                className="h-7 px-3 text-xs"
                            >
                                <Square className="h-3 w-3 mr-1" />
                                Stop
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                variant="default"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (onExecute) {
                                        onExecute(editedConfig);
                                    } else {
                                        console.warn('onExecute is not provided');
                                    }
                                }}
                                disabled={!isValid}
                                className="h-7 px-3 text-xs relative z-10"
                                type="button"
                            >
                                <Play className="h-3 w-3 mr-1" />
                                Play
                            </Button>
                        )}

                        {/* Additional Actions (only when not executing) */}
                        {!isExecuting && (
                            <>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => onDuplicate?.(editedConfig)}
                                    className="h-7 w-7 p-0"
                                >
                                    <Copy className="h-3 w-3" />
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => onDelete?.(editedConfig)}
                                    className="h-7 w-7 p-0 text-red-500"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {/* Validation Errors */}
                {validation.errors.length > 0 && (
                    <div className="mt-2 p-2 bg-red-100 border border-red-200 rounded text-xs text-red-700">
                        <ul className="list-disc list-inside space-y-1">
                            {validation.errors.map((error, index) => (
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
                            {/* Provider Selection */}
                            <div className="space-y-1">
                                <Label className="text-xs font-medium">Provider</Label>
                                <Select
                                    value={editedConfig.defaultModel.provider}
                                    onValueChange={(value) => handleConfigUpdate({
                                        defaultModel: {
                                            ...editedConfig.defaultModel,
                                            provider: value
                                        }
                                    })}
                                    disabled={isExecuting}
                                >
                                    <SelectTrigger className="h-8 text-xs">
                                        <SelectValue placeholder="Select Provider" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="openai">OpenAI</SelectItem>
                                        <SelectItem value="anthropic">Anthropic</SelectItem>
                                        <SelectItem value="google">Google</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Model Selection */}
                            <div className="space-y-1">
                                <Label className="text-xs font-medium">Model</Label>
                                <Select
                                    value={editedConfig.defaultModel.model}
                                    onValueChange={(value) => handleConfigUpdate({
                                        defaultModel: {
                                            ...editedConfig.defaultModel,
                                            model: value
                                        }
                                    })}
                                    disabled={isExecuting}
                                >
                                    <SelectTrigger className="h-8 text-xs">
                                        <SelectValue placeholder="Select Model" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="gpt-4">GPT-4</SelectItem>
                                        <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
                                        <SelectItem value="claude-3-opus">Claude 3 Opus</SelectItem>
                                        <SelectItem value="claude-3-sonnet">Claude 3 Sonnet</SelectItem>
                                        <SelectItem value="gemini-pro">Gemini Pro</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Temperature */}
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <Label className="text-xs font-medium">Temperature</Label>
                                <span className="text-xs text-gray-500">{editedConfig.defaultModel.temperature || 0.7}</span>
                            </div>
                            <input
                                type="range"
                                value={editedConfig.defaultModel.temperature || 0.7}
                                onChange={(e) => handleConfigUpdate({
                                    defaultModel: {
                                        ...editedConfig.defaultModel,
                                        temperature: parseFloat(e.target.value)
                                    }
                                })}
                                max={2}
                                min={0}
                                step={0.1}
                                disabled={isExecuting}
                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>

                        {/* Max Tokens */}
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <Label className="text-xs font-medium">Max Tokens</Label>
                                <span className="text-xs text-gray-500">{editedConfig.defaultModel.maxTokens || 2000}</span>
                            </div>
                            <input
                                type="range"
                                value={editedConfig.defaultModel.maxTokens || 2000}
                                onChange={(e) => handleConfigUpdate({
                                    defaultModel: {
                                        ...editedConfig.defaultModel,
                                        maxTokens: parseInt(e.target.value)
                                    }
                                })}
                                max={4000}
                                min={100}
                                step={100}
                                disabled={isExecuting}
                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>

                        {/* System Message */}
                        <div className="space-y-1">
                            <Label className="text-xs font-medium">System Message</Label>
                            <Textarea
                                value={editedConfig.defaultModel.systemMessage || ''}
                                onChange={(e) => handleConfigUpdate({
                                    defaultModel: {
                                        ...editedConfig.defaultModel,
                                        systemMessage: e.target.value
                                    }
                                })}
                                placeholder="You are a helpful AI assistant..."
                                className="min-h-[60px] text-xs resize-none"
                                disabled={isExecuting}
                            />
                        </div>
                    </TabsContent>

                    {/* Tools Configuration */}
                    <TabsContent value="tools" className="space-y-3 mt-3">
                        <div className="space-y-2">
                            <Label className="text-xs font-medium">Available Tools ({(editedConfig.tools || []).length})</Label>
                            <div className="space-y-2 max-h-32 overflow-y-auto">
                                {(editedConfig.tools || []).map((tool, index) => (
                                    <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded text-xs">
                                        <div>
                                            <div className="font-medium">{tool.name}</div>
                                            <div className="text-gray-500">{tool.description}</div>
                                        </div>
                                        <Badge variant="secondary" className="text-xs">Active</Badge>
                                    </div>
                                ))}
                                {(!editedConfig.tools || editedConfig.tools.length === 0) && (
                                    <div className="text-center py-4 text-xs text-gray-500">
                                        No tools configured
                                    </div>
                                )}
                            </div>
                        </div>
                    </TabsContent>

                    {/* Plugins Configuration */}
                    <TabsContent value="plugins" className="space-y-3 mt-3">
                        <div className="space-y-2">
                            <Label className="text-xs font-medium">Active Plugins ({(editedConfig.plugins || []).length})</Label>
                            <div className="space-y-2 max-h-32 overflow-y-auto">
                                {(editedConfig.plugins || []).map((plugin, index) => (
                                    <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded text-xs">
                                        <div>
                                            <div className="font-medium">{plugin.constructor.name}</div>
                                            <div className="text-gray-500">Plugin configuration</div>
                                        </div>
                                        <Badge variant="secondary" className="text-xs">Enabled</Badge>
                                    </div>
                                ))}
                                {(!editedConfig.plugins || editedConfig.plugins.length === 0) && (
                                    <div className="text-center py-4 text-xs text-gray-500">
                                        No plugins configured
                                    </div>
                                )}
                            </div>
                        </div>
                    </TabsContent>

                    {/* Settings Configuration */}
                    <TabsContent value="settings" className="space-y-3 mt-3">
                        <div className="space-y-3">
                            {/* Name */}
                            <div className="space-y-1">
                                <Label className="text-xs font-medium">Agent Name</Label>
                                <Input
                                    value={editedConfig.name}
                                    onChange={(e) => handleConfigUpdate({ name: e.target.value })}
                                    placeholder="Agent Name"
                                    className="h-8 text-xs"
                                    disabled={isExecuting}
                                />
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
} 