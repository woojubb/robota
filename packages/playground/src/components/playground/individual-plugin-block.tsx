'use client';

const PERCENTAGE_MULTIPLIER = 100;

import React, { useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import { Progress } from '../ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Puzzle, Settings, Activity, BarChart3, Trash2, ChevronDown, ChevronRight, AlertCircle, CheckCircle, Info, TrendingUp, Clock } from 'lucide-react';
import type { TUniversalValue } from '@robota-sdk/agents';
import { AVAILABLE_PLUGINS, CATEGORY_ICONS, CATEGORY_COLORS, type IPluginBlock } from './plugin-container-block-types';

function PluginOptionInput({ option, value, onChange, disabled = false }: {
    option: { type: string; default?: TUniversalValue; description: string; options?: string[] };
    value: TUniversalValue; onChange: (value: TUniversalValue) => void; disabled?: boolean;
}) {
    switch (option.type) {
        case 'boolean':
            return <Switch checked={Boolean(value)} onCheckedChange={onChange} disabled={disabled} />;
        case 'number':
            return <Input type="number" value={Number(value || option.default || 0)} onChange={(e) => onChange(Number(e.target.value))} placeholder={option.description} disabled={disabled} className="h-8 text-xs" />;
        case 'select':
            return (
                <Select value={String(value || option.default)} onValueChange={onChange} disabled={disabled}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {option.options?.map((opt) => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}
                    </SelectContent>
                </Select>
            );
        default:
            return <Input value={String(value || '')} onChange={(e) => onChange(e.target.value)} placeholder={option.description} disabled={disabled} className="h-8 text-xs" />;
    }
}

export function IndividualPluginBlock({ pluginBlock, onUpdate, onRemove, onToggle, isEditable = false }: {
    pluginBlock: IPluginBlock; onUpdate: (pluginBlock: IPluginBlock) => void;
    onRemove: () => void; onToggle: (enabled: boolean) => void; isEditable?: boolean;
}) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [activeTab, setActiveTab] = useState('options');
    const hasErrors = pluginBlock.validationErrors.length > 0;
    const CategoryIcon = CATEGORY_ICONS[pluginBlock.category] || Puzzle;
    const categoryColor = CATEGORY_COLORS[pluginBlock.category] || 'text-gray-600';

    const statusIcon = useMemo(() => {
        if (hasErrors) return <AlertCircle className="h-3 w-3 text-red-500" />;
        if (pluginBlock.isEnabled) return <CheckCircle className="h-3 w-3 text-green-500" />;
        return <Info className="h-3 w-3 text-gray-400" />;
    }, [hasErrors, pluginBlock.isEnabled]);

    const handleOptionChange = useCallback((key: string, value: TUniversalValue) => {
        onUpdate({ ...pluginBlock, options: { ...pluginBlock.options, [key]: value } });
    }, [pluginBlock, onUpdate]);

    const handleToggleEnabled = useCallback(() => {
        const newEnabled = !pluginBlock.isEnabled;
        onUpdate({ ...pluginBlock, isEnabled: newEnabled });
        onToggle(newEnabled);
    }, [pluginBlock, onUpdate, onToggle]);

    const successRate = pluginBlock.stats.calls > 0
        ? Math.round(((pluginBlock.stats.calls - pluginBlock.stats.errors) / pluginBlock.stats.calls) * PERCENTAGE_MULTIPLIER)
        : 0;

    return (
        <Card className={`transition-all duration-200 border ${pluginBlock.isActive ? 'border-purple-500 bg-purple-50' : 'border-gray-200'} ${hasErrors ? 'border-red-300 bg-red-50' : ''} ${!pluginBlock.isEnabled ? 'opacity-60' : ''}`}>
            <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                <CollapsibleTrigger asChild>
                    <CardHeader className="pb-2 cursor-pointer hover:bg-gray-50">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                {isExpanded ? <ChevronDown className="h-3 w-3 text-gray-400" /> : <ChevronRight className="h-3 w-3 text-gray-400" />}
                                <CategoryIcon className={`h-4 w-4 ${categoryColor}`} />
                                <CardTitle className="text-xs font-medium">{pluginBlock.plugin.name}</CardTitle>
                                {statusIcon}
                            </div>
                            <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs px-1 py-0">Priority: {pluginBlock.priority}</Badge>
                                <Switch checked={pluginBlock.isEnabled} onCheckedChange={handleToggleEnabled} disabled={!isEditable} />
                                {isEditable && (
                                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="h-6 w-6 p-0 text-red-500">
                                        <Trash2 className="h-3 w-3" />
                                    </Button>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                            <Badge variant="secondary" className="text-xs">{pluginBlock.category}</Badge>
                            <span>{pluginBlock.stats.calls} calls</span>
                            {pluginBlock.stats.errors > 0 && <span className="text-red-500">{pluginBlock.stats.errors} errors</span>}
                        </div>
                        {pluginBlock.validationErrors.length > 0 && (
                            <div className="mt-1 text-xs text-red-600">{pluginBlock.validationErrors[0]}</div>
                        )}
                    </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <CardContent className="pt-0">
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                            <TabsList className="grid w-full grid-cols-3 text-xs">
                                <TabsTrigger value="options" className="flex items-center gap-1"><Settings className="h-3 w-3" />Options</TabsTrigger>
                                <TabsTrigger value="stats" className="flex items-center gap-1"><BarChart3 className="h-3 w-3" />Stats</TabsTrigger>
                                <TabsTrigger value="info" className="flex items-center gap-1"><Info className="h-3 w-3" />Info</TabsTrigger>
                            </TabsList>
                            <TabsContent value="options" className="space-y-3 mt-3">
                                {Object.entries(pluginBlock.options).length === 0 ? (
                                    <div className="text-center py-4 text-xs text-gray-500">
                                        <Settings className="h-6 w-6 mx-auto mb-2 opacity-50" /><p>No configuration options available</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {Object.entries(pluginBlock.options).map(([key, value]) => {
                                            const availablePlugin = AVAILABLE_PLUGINS.find(p => p.name === pluginBlock.plugin.name);
                                            const optionConfig = availablePlugin?.options[key as keyof typeof availablePlugin.options];
                                            if (!optionConfig) return null;
                                            return (
                                                <div key={key} className="space-y-1">
                                                    <Label className="text-xs text-gray-600">{key}</Label>
                                                    <PluginOptionInput option={optionConfig} value={value} onChange={(newValue) => handleOptionChange(key, newValue)} disabled={!isEditable || !pluginBlock.isEnabled} />
                                                    <p className="text-xs text-gray-400">{optionConfig.description}</p>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </TabsContent>
                            <TabsContent value="stats" className="space-y-3 mt-3">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-green-600" /><Label className="text-xs">Total Calls</Label></div>
                                        <div className="text-lg font-semibold text-green-600">{pluginBlock.stats.calls}</div>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-red-600" /><Label className="text-xs">Errors</Label></div>
                                        <div className="text-lg font-semibold text-red-600">{pluginBlock.stats.errors}</div>
                                    </div>
                                </div>
                                {pluginBlock.stats.lastActivity && (
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-blue-600" /><Label className="text-xs">Last Activity</Label></div>
                                        <div className="text-xs text-gray-600">{pluginBlock.stats.lastActivity.toLocaleString()}</div>
                                    </div>
                                )}
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-purple-600" /><Label className="text-xs">Success Rate</Label></div>
                                    <div className="flex items-center gap-2">
                                        <Progress value={successRate} className="h-2 flex-1" />
                                        <span className="text-xs text-gray-600">{successRate}%</span>
                                    </div>
                                </div>
                            </TabsContent>
                            <TabsContent value="info" className="space-y-3 mt-3">
                                <div className="space-y-3">
                                    <div><Label className="text-xs font-medium">Name</Label><p className="text-xs text-gray-600">{pluginBlock.plugin.name}</p></div>
                                    <div><Label className="text-xs font-medium">Version</Label><p className="text-xs text-gray-600">{pluginBlock.plugin.version}</p></div>
                                    <div><Label className="text-xs font-medium">Category</Label><Badge variant="outline" className="text-xs">{pluginBlock.category}</Badge></div>
                                    <div><Label className="text-xs font-medium">Priority</Label><p className="text-xs text-gray-600">{pluginBlock.priority} (Higher numbers execute first)</p></div>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </CardContent>
                </CollapsibleContent>
            </Collapsible>
        </Card>
    );
}
