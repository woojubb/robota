'use client';

import { useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Switch } from '../ui/switch';
import { ScrollArea } from '../ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import {
    Zap, Plus, Play, Trash2, ChevronDown, ChevronRight,
    AlertCircle, CheckCircle, Info, Search
} from 'lucide-react';
import type { IToolSchema, TUniversalValue } from '@robota-sdk/agents';
import type { IPlaygroundTool } from '../../lib/playground/robota-executor';
import {
    type IToolBlock, type IToolContainerBlockProps, type TToolSchemaParameter,
    RANDOM_ID_BASE, RANDOM_ID_LENGTH, AVAILABLE_TOOLS, getMaxHeightClass
} from './tool-container-block-types';

// Re-export types for external consumers
export type { IToolBlock, IToolContainerBlockProps } from './tool-container-block-types';

function getToolSchema(tool: IPlaygroundTool): IToolSchema | undefined {
    if ('schema' in tool && tool.schema) return tool.schema;
    return undefined;
}

function ToolParameterInput({ parameter, value, onChange, disabled = false }: {
    parameter: { type: string; description?: string; default?: TUniversalValue };
    value: TUniversalValue;
    onChange: (value: TUniversalValue) => void;
    disabled?: boolean;
}) {
    switch (parameter.type) {
        case 'string':
            return <Input value={String(value || '')} onChange={(e) => onChange(e.target.value)} placeholder={parameter.description} disabled={disabled} className="h-8 text-xs" />;
        case 'number':
            return <Input type="number" value={Number(value || parameter.default || 0)} onChange={(e) => onChange(Number(e.target.value))} placeholder={parameter.description} disabled={disabled} className="h-8 text-xs" />;
        case 'boolean':
            return <Switch checked={Boolean(value)} onCheckedChange={onChange} disabled={disabled} />;
        default:
            return <Textarea value={String(value || '')} onChange={(e) => onChange(e.target.value)} placeholder={parameter.description} disabled={disabled} className="min-h-[60px] text-xs resize-none" />;
    }
}

function IndividualToolBlock({ toolBlock, onUpdate, onRemove, onExecute, isEditable = false }: {
    toolBlock: IToolBlock;
    onUpdate: (toolBlock: IToolBlock) => void;
    onRemove: () => void;
    onExecute: (parameters: Record<string, TUniversalValue>) => void;
    isEditable?: boolean;
}) {
    const [isExpanded, setIsExpanded] = useState(false);
    const hasErrors = toolBlock.validationErrors.length > 0;

    const statusIcon = useMemo(() => {
        if (hasErrors) return <AlertCircle className="h-3 w-3 text-red-500" />;
        if (toolBlock.isEnabled) return <CheckCircle className="h-3 w-3 text-green-500" />;
        return <Info className="h-3 w-3 text-gray-400" />;
    }, [hasErrors, toolBlock.isEnabled]);

    const handleParameterChange = useCallback((key: string, value: TUniversalValue) => {
        onUpdate({ ...toolBlock, parameters: { ...toolBlock.parameters, [key]: value } });
    }, [toolBlock, onUpdate]);

    const handleToggleEnabled = useCallback(() => {
        onUpdate({ ...toolBlock, isEnabled: !toolBlock.isEnabled });
    }, [toolBlock, onUpdate]);

    return (
        <Card className={`transition-all duration-200 border ${toolBlock.isActive ? 'border-blue-500 bg-blue-50' : 'border-gray-200'} ${hasErrors ? 'border-red-300 bg-red-50' : ''} ${!toolBlock.isEnabled ? 'opacity-60' : ''}`}>
            <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                <CollapsibleTrigger asChild>
                    <CardHeader className="pb-2 cursor-pointer hover:bg-gray-50">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                {isExpanded ? <ChevronDown className="h-3 w-3 text-gray-400" /> : <ChevronRight className="h-3 w-3 text-gray-400" />}
                                <Zap className="h-4 w-4 text-orange-600" />
                                <CardTitle className="text-xs font-medium">{toolBlock.tool.name}</CardTitle>
                                {statusIcon}
                            </div>
                            <div className="flex items-center gap-1">
                                <Switch checked={toolBlock.isEnabled} onCheckedChange={handleToggleEnabled} disabled={!isEditable} />
                                {isEditable && (
                                    <>
                                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onExecute(toolBlock.parameters); }} className="h-6 w-6 p-0">
                                            <Play className="h-3 w-3" />
                                        </Button>
                                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="h-6 w-6 p-0 text-red-500">
                                            <Trash2 className="h-3 w-3" />
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>
                        <p className="text-xs text-gray-500 text-left">{toolBlock.tool.description}</p>
                        {toolBlock.validationErrors.length > 0 && (
                            <div className="mt-1 text-xs text-red-600">{toolBlock.validationErrors[0]}</div>
                        )}
                    </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <CardContent className="pt-0">
                        <div className="space-y-3">
                            <div className="space-y-2">
                                <Label className="text-xs font-medium">Parameters</Label>
                                {Object.entries(getToolSchema(toolBlock.tool)?.parameters?.properties || {}).map(([key, paramConfig]) => (
                                    <div key={key} className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <Label className="text-xs text-gray-600">
                                                {key}
                                                {getToolSchema(toolBlock.tool)?.parameters?.required?.includes(key) && <span className="text-red-500">*</span>}
                                            </Label>
                                            {getToolSchema(toolBlock.tool)?.parameters?.required?.includes(key) && (
                                                <Badge variant="outline" className="text-xs px-1 py-0">Required</Badge>
                                            )}
                                        </div>
                                        <ToolParameterInput parameter={paramConfig as TToolSchemaParameter} value={toolBlock.parameters[key]} onChange={(value) => handleParameterChange(key, value)} disabled={!isEditable || !toolBlock.isEnabled} />
                                        <p className="text-xs text-gray-400">{(paramConfig as TToolSchemaParameter).description}</p>
                                    </div>
                                ))}
                            </div>
                            {toolBlock.isEnabled && Object.keys(toolBlock.parameters).length > 0 && (
                                <div className="space-y-1">
                                    <Label className="text-xs font-medium">Execution Preview</Label>
                                    <div className="p-2 bg-gray-50 rounded text-xs">
                                        <code className="text-gray-700">{toolBlock.tool.name}({JSON.stringify(toolBlock.parameters)})</code>
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
    tools, isEditable = false, onToolsChange, onToolAdd, onToolRemove, onToolExecute,
    className = '', maxHeight = '400px'
}: IToolContainerBlockProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [showToolLibrary, setShowToolLibrary] = useState(false);
    const maxHeightClassName = getMaxHeightClass(maxHeight);

    const filteredAvailableTools = useMemo(() => {
        return AVAILABLE_TOOLS.filter(tool =>
            tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            tool.description.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [searchQuery]);

    const handleToolUpdate = useCallback((updatedTool: IToolBlock) => {
        onToolsChange(tools.map(tool => tool.id === updatedTool.id ? updatedTool : tool));
    }, [tools, onToolsChange]);

    const handleToolRemove = useCallback((toolId: string) => {
        onToolsChange(tools.filter(tool => tool.id !== toolId));
        onToolRemove?.(toolId);
    }, [tools, onToolsChange, onToolRemove]);

    const handleToolExecute = useCallback((toolId: string, parameters: Record<string, TUniversalValue>) => {
        onToolExecute?.(toolId, parameters);
    }, [onToolExecute]);

    const handleAddTool = useCallback((toolName: string) => {
        const toolDefinition = AVAILABLE_TOOLS.find(t => t.name === toolName);
        if (!toolDefinition) return;
        const emptyResult: Record<string, TUniversalValue> = {};
        const newTool: IToolBlock = {
            id: `tool_${Date.now()}_${Math.random().toString(RANDOM_ID_BASE).substr(2, RANDOM_ID_LENGTH)}`,
            tool: { name: toolDefinition.name, description: toolDefinition.description, execute: async () => emptyResult },
            isActive: false, isEnabled: true, parameters: {}, validationErrors: []
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
                        <CardTitle className="text-sm font-semibold">Tools ({tools.length})</CardTitle>
                    </div>
                    {isEditable && (
                        <Button size="sm" variant="outline" onClick={() => setShowToolLibrary(!showToolLibrary)} className="h-7 px-2 text-xs">
                            <Plus className="h-3 w-3 mr-1" />Add Tool
                        </Button>
                    )}
                </div>
                {showToolLibrary && (
                    <div className="mt-3 p-3 border border-gray-200 rounded-lg bg-gray-50">
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Search className="h-4 w-4 text-gray-400" />
                                <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search tools..." className="h-8 text-xs" />
                            </div>
                            <ScrollArea className="h-32">
                                <div className="space-y-2">
                                    {filteredAvailableTools.map((tool) => (
                                        <div key={tool.name} className="flex items-center justify-between p-2 bg-white rounded border hover:bg-gray-50 cursor-pointer" onClick={() => handleAddTool(tool.name)}>
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
                        {isEditable && <p className="mt-1">Click "Add Tool" to get started</p>}
                    </div>
                ) : (
                    <ScrollArea className={`w-full ${maxHeightClassName}`}>
                        <div className="space-y-3">
                            {tools.map((toolBlock) => (
                                <IndividualToolBlock key={toolBlock.id} toolBlock={toolBlock} onUpdate={handleToolUpdate} onRemove={() => handleToolRemove(toolBlock.id)} onExecute={(params) => handleToolExecute(toolBlock.id, params)} isEditable={isEditable} />
                            ))}
                        </div>
                    </ScrollArea>
                )}
            </CardContent>
        </Card>
    );
}
