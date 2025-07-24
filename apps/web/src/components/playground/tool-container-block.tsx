'use client';

/**
 * ToolContainerBlock - Visual Tool Configuration Component
 * 
 * This component provides a visual block-coding style representation of
 * Tools within an Agent configuration in the Playground interface.
 * 
 * Features:
 * - Individual tool blocks with drag & drop
 * - Tool parameter visualization and editing
 * - Tool execution preview
 * - Tool library and discovery
 * - Validation and error handling
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
    Zap,
    Plus,
    Minus,
    Settings,
    Code,
    Play,
    Eye,
    Edit3,
    Trash2,
    ChevronDown,
    ChevronRight,
    AlertCircle,
    CheckCircle,
    Info,
    Search,
    Filter
} from 'lucide-react';
import type { BaseTool } from '@/lib/playground/robota-executor';

export interface ToolBlock {
    id: string;
    tool: BaseTool;
    isActive: boolean;
    isEnabled: boolean;
    parameters: Record<string, unknown>;
    validationErrors: string[];
}

export interface ToolContainerBlockProps {
    tools: ToolBlock[];
    isEditable?: boolean;
    onToolsChange: (tools: ToolBlock[]) => void;
    onToolAdd?: (toolType: string) => void;
    onToolRemove?: (toolId: string) => void;
    onToolExecute?: (toolId: string, parameters: Record<string, unknown>) => void;
    className?: string;
    maxHeight?: string;
}

// Mock tool definitions for demonstration
const AVAILABLE_TOOLS = [
    {
        name: 'web_search',
        description: 'Search the web for information',
        parameters: {
            query: { type: 'string', required: true, description: 'Search query' },
            max_results: { type: 'number', required: false, description: 'Maximum results', default: 10 }
        }
    },
    {
        name: 'file_reader',
        description: 'Read and analyze files',
        parameters: {
            file_path: { type: 'string', required: true, description: 'Path to file' },
            encoding: { type: 'string', required: false, description: 'File encoding', default: 'utf-8' }
        }
    },
    {
        name: 'calculator',
        description: 'Perform mathematical calculations',
        parameters: {
            expression: { type: 'string', required: true, description: 'Mathematical expression' }
        }
    },
    {
        name: 'code_executor',
        description: 'Execute code in various languages',
        parameters: {
            code: { type: 'string', required: true, description: 'Code to execute' },
            language: { type: 'string', required: true, description: 'Programming language' },
            timeout: { type: 'number', required: false, description: 'Execution timeout (ms)', default: 5000 }
        }
    }
];

function ToolParameterInput({
    parameter,
    value,
    onChange,
    disabled = false
}: {
    parameter: { type: string; required: boolean; description: string; default?: unknown };
    value: unknown;
    onChange: (value: unknown) => void;
    disabled?: boolean;
}) {
    switch (parameter.type) {
        case 'string':
            return (
                <Input
                    value={String(value || '')}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={parameter.description}
                    disabled={disabled}
                    className="h-8 text-xs"
                />
            );
        case 'number':
            return (
                <Input
                    type="number"
                    value={Number(value || parameter.default || 0)}
                    onChange={(e) => onChange(Number(e.target.value))}
                    placeholder={parameter.description}
                    disabled={disabled}
                    className="h-8 text-xs"
                />
            );
        case 'boolean':
            return (
                <Switch
                    checked={Boolean(value)}
                    onCheckedChange={onChange}
                    disabled={disabled}
                />
            );
        default:
            return (
                <Textarea
                    value={String(value || '')}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={parameter.description}
                    disabled={disabled}
                    className="min-h-[60px] text-xs resize-none"
                />
            );
    }
}

function IndividualToolBlock({
    toolBlock,
    onUpdate,
    onRemove,
    onExecute,
    isEditable = false
}: {
    toolBlock: ToolBlock;
    onUpdate: (toolBlock: ToolBlock) => void;
    onRemove: () => void;
    onExecute: (parameters: Record<string, unknown>) => void;
    isEditable?: boolean;
}) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

    const hasErrors = toolBlock.validationErrors.length > 0;
    const statusIcon = useMemo(() => {
        if (hasErrors) return <AlertCircle className="h-3 w-3 text-red-500" />;
        if (toolBlock.isEnabled) return <CheckCircle className="h-3 w-3 text-green-500" />;
        return <Info className="h-3 w-3 text-gray-400" />;
    }, [hasErrors, toolBlock.isEnabled]);

    const handleParameterChange = useCallback((key: string, value: unknown) => {
        const updatedParameters = { ...toolBlock.parameters, [key]: value };
        onUpdate({
            ...toolBlock,
            parameters: updatedParameters
        });
    }, [toolBlock, onUpdate]);

    const handleToggleEnabled = useCallback(() => {
        onUpdate({
            ...toolBlock,
            isEnabled: !toolBlock.isEnabled
        });
    }, [toolBlock, onUpdate]);

    return (
        <Card className={`
      transition-all duration-200 border
      ${toolBlock.isActive ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}
      ${hasErrors ? 'border-red-300 bg-red-50' : ''}
      ${!toolBlock.isEnabled ? 'opacity-60' : ''}
    `}>
            <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                <CollapsibleTrigger asChild>
                    <CardHeader className="pb-2 cursor-pointer hover:bg-gray-50">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                {isExpanded ? (
                                    <ChevronDown className="h-3 w-3 text-gray-400" />
                                ) : (
                                    <ChevronRight className="h-3 w-3 text-gray-400" />
                                )}
                                <Zap className="h-4 w-4 text-orange-600" />
                                <CardTitle className="text-xs font-medium">
                                    {toolBlock.tool.name}
                                </CardTitle>
                                {statusIcon}
                            </div>

                            <div className="flex items-center gap-1">
                                <Switch
                                    checked={toolBlock.isEnabled}
                                    onCheckedChange={handleToggleEnabled}
                                    disabled={!isEditable}
                                    size="sm"
                                />

                                {isEditable && (
                                    <>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onExecute(toolBlock.parameters);
                                            }}
                                            className="h-6 w-6 p-0"
                                        >
                                            <Play className="h-3 w-3" />
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onRemove();
                                            }}
                                            className="h-6 w-6 p-0 text-red-500"
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>

                        <p className="text-xs text-gray-500 text-left">
                            {toolBlock.tool.description}
                        </p>

                        {toolBlock.validationErrors.length > 0 && (
                            <div className="mt-1 text-xs text-red-600">
                                {toolBlock.validationErrors[0]}
                            </div>
                        )}
                    </CardHeader>
                </CollapsibleTrigger>

                <CollapsibleContent>
                    <CardContent className="pt-0">
                        <div className="space-y-3">
                            {/* Tool Parameters */}
                            <div className="space-y-2">
                                <Label className="text-xs font-medium">Parameters</Label>
                                {Object.entries(toolBlock.tool.parameters || {}).map(([key, paramConfig]) => (
                                    <div key={key} className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <Label className="text-xs text-gray-600">
                                                {key}
                                                {paramConfig.required && <span className="text-red-500">*</span>}
                                            </Label>
                                            {paramConfig.required && (
                                                <Badge variant="outline" className="text-xs px-1 py-0">
                                                    Required
                                                </Badge>
                                            )}
                                        </div>
                                        <ToolParameterInput
                                            parameter={paramConfig}
                                            value={toolBlock.parameters[key]}
                                            onChange={(value) => handleParameterChange(key, value)}
                                            disabled={!isEditable || !toolBlock.isEnabled}
                                        />
                                        <p className="text-xs text-gray-400">{paramConfig.description}</p>
                                    </div>
                                ))}
                            </div>

                            {/* Execution Preview */}
                            {toolBlock.isEnabled && Object.keys(toolBlock.parameters).length > 0 && (
                                <div className="space-y-1">
                                    <Label className="text-xs font-medium">Execution Preview</Label>
                                    <div className="p-2 bg-gray-50 rounded text-xs">
                                        <code className="text-gray-700">
                                            {toolBlock.tool.name}({JSON.stringify(toolBlock.parameters)})
                                        </code>
                                    </div>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </CollapsibleContent>
            </Collapsible>
        </Card>
    );
}

export function ToolContainerBlock({
    tools,
    isEditable = false,
    onToolsChange,
    onToolAdd,
    onToolRemove,
    onToolExecute,
    className = '',
    maxHeight = '400px'
}: ToolContainerBlockProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [showToolLibrary, setShowToolLibrary] = useState(false);

    // Filter available tools
    const filteredAvailableTools = useMemo(() => {
        return AVAILABLE_TOOLS.filter(tool =>
            tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            tool.description.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [searchQuery]);

    // Handle tool updates
    const handleToolUpdate = useCallback((updatedTool: ToolBlock) => {
        const updatedTools = tools.map(tool =>
            tool.id === updatedTool.id ? updatedTool : tool
        );
        onToolsChange(updatedTools);
    }, [tools, onToolsChange]);

    // Handle tool removal
    const handleToolRemove = useCallback((toolId: string) => {
        const updatedTools = tools.filter(tool => tool.id !== toolId);
        onToolsChange(updatedTools);
        onToolRemove?.(toolId);
    }, [tools, onToolsChange, onToolRemove]);

    // Handle tool execution
    const handleToolExecute = useCallback((toolId: string, parameters: Record<string, unknown>) => {
        onToolExecute?.(toolId, parameters);
    }, [onToolExecute]);

    // Add new tool
    const handleAddTool = useCallback((toolName: string) => {
        const toolDefinition = AVAILABLE_TOOLS.find(t => t.name === toolName);
        if (!toolDefinition) return;

        const newTool: ToolBlock = {
            id: `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            tool: {
                name: toolDefinition.name,
                description: toolDefinition.description,
                execute: async () => ({}),
                parameters: toolDefinition.parameters
            } as BaseTool,
            isActive: false,
            isEnabled: true,
            parameters: {},
            validationErrors: []
        };

        onToolsChange([...tools, newTool]);
        onToolAdd?.(toolName);
        setShowToolLibrary(false);
    }, [tools, onToolsChange, onToolAdd]);

    return (
        <Card className={`${className}`}>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Zap className="h-5 w-5 text-orange-600" />
                        <CardTitle className="text-sm font-semibold">
                            Tools ({tools.length})
                        </CardTitle>
                    </div>

                    {isEditable && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setShowToolLibrary(!showToolLibrary)}
                            className="h-7 px-2 text-xs"
                        >
                            <Plus className="h-3 w-3 mr-1" />
                            Add Tool
                        </Button>
                    )}
                </div>

                {/* Tool Library */}
                {showToolLibrary && (
                    <div className="mt-3 p-3 border border-gray-200 rounded-lg bg-gray-50">
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Search className="h-4 w-4 text-gray-400" />
                                <Input
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search tools..."
                                    className="h-8 text-xs"
                                />
                            </div>

                            <ScrollArea className="h-32">
                                <div className="space-y-2">
                                    {filteredAvailableTools.map((tool) => (
                                        <div
                                            key={tool.name}
                                            className="flex items-center justify-between p-2 bg-white rounded border hover:bg-gray-50 cursor-pointer"
                                            onClick={() => handleAddTool(tool.name)}
                                        >
                                            <div>
                                                <p className="text-xs font-medium">{tool.name}</p>
                                                <p className="text-xs text-gray-500">{tool.description}</p>
                                            </div>
                                            <Plus className="h-3 w-3 text-gray-400" />
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </div>
                    </div>
                )}
            </CardHeader>

            <CardContent className="pt-0">
                {tools.length === 0 ? (
                    <div className="text-center py-6 text-xs text-gray-500">
                        <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No tools configured</p>
                        {isEditable && (
                            <p className="mt-1">Click "Add Tool" to get started</p>
                        )}
                    </div>
                ) : (
                    <ScrollArea style={{ maxHeight }} className="w-full">
                        <div className="space-y-3">
                            {tools.map((toolBlock) => (
                                <IndividualToolBlock
                                    key={toolBlock.id}
                                    toolBlock={toolBlock}
                                    onUpdate={handleToolUpdate}
                                    onRemove={() => handleToolRemove(toolBlock.id)}
                                    onExecute={(params) => handleToolExecute(toolBlock.id, params)}
                                    isEditable={isEditable}
                                />
                            ))}
                        </div>
                    </ScrollArea>
                )}
            </CardContent>
        </Card>
    );
} 