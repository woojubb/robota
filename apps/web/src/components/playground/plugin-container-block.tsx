'use client';

/**
 * PluginContainerBlock - Visual Plugin Configuration Component
 * 
 * This component provides a visual block-coding style representation of
 * Plugins within an Agent configuration in the Playground interface.
 * 
 * Features:
 * - Plugin blocks with enable/disable controls
 * - Plugin configuration and options
 * - Plugin statistics and monitoring
 * - Plugin library and discovery
 * - Category-based organization
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Puzzle,
    Plus,
    Settings,
    Activity,
    BarChart3,
    Play,
    Pause,
    Edit3,
    Trash2,
    ChevronDown,
    ChevronRight,
    AlertCircle,
    CheckCircle,
    Info,
    Search,
    Filter,
    TrendingUp,
    Clock,
    Database,
    Globe,
    Shield,
    Zap
} from 'lucide-react';
import type { BasePlugin, PluginCategory, PluginPriority } from '@/lib/playground/plugins/playground-history-plugin';

export interface PluginBlock {
    id: string;
    plugin: BasePlugin;
    isActive: boolean;
    isEnabled: boolean;
    category: PluginCategory;
    priority: number;
    options: Record<string, unknown>;
    stats: {
        calls: number;
        errors: number;
        lastActivity?: Date;
        [key: string]: unknown;
    };
    validationErrors: string[];
}

export interface PluginContainerBlockProps {
    plugins: PluginBlock[];
    isEditable?: boolean;
    onPluginsChange: (plugins: PluginBlock[]) => void;
    onPluginAdd?: (pluginType: string) => void;
    onPluginRemove?: (pluginId: string) => void;
    onPluginToggle?: (pluginId: string, enabled: boolean) => void;
    className?: string;
    maxHeight?: string;
}

// Mock plugin definitions for demonstration
const AVAILABLE_PLUGINS = [
    {
        name: 'HistoryPlugin',
        description: 'Track and visualize conversation history',
        category: 'STORAGE' as PluginCategory,
        priority: 10,
        options: {
            enabled: { type: 'boolean', default: true, description: 'Enable plugin' },
            maxEvents: { type: 'number', default: 1000, description: 'Maximum events to store' },
            strategy: { type: 'select', options: ['auto', 'silent', 'verbose'], default: 'auto' }
        }
    },
    {
        name: 'LoggingPlugin',
        description: 'Comprehensive logging and monitoring',
        category: 'MONITORING' as PluginCategory,
        priority: 5,
        options: {
            enabled: { type: 'boolean', default: true, description: 'Enable plugin' },
            logLevel: { type: 'select', options: ['debug', 'info', 'warn', 'error'], default: 'info' },
            logToConsole: { type: 'boolean', default: false, description: 'Log to console' }
        }
    },
    {
        name: 'MetricsPlugin',
        description: 'Performance metrics and analytics',
        category: 'ANALYTICS' as PluginCategory,
        priority: 8,
        options: {
            enabled: { type: 'boolean', default: true, description: 'Enable plugin' },
            collectTiming: { type: 'boolean', default: true, description: 'Collect timing data' },
            collectTokens: { type: 'boolean', default: true, description: 'Collect token usage' }
        }
    },
    {
        name: 'SecurityPlugin',
        description: 'Security and access control',
        category: 'SECURITY' as PluginCategory,
        priority: 15,
        options: {
            enabled: { type: 'boolean', default: true, description: 'Enable plugin' },
            enforceRateLimit: { type: 'boolean', default: true, description: 'Enforce rate limiting' },
            maxRequestsPerMinute: { type: 'number', default: 60, description: 'Max requests per minute' }
        }
    }
];

const CATEGORY_ICONS = {
    STORAGE: Database,
    MONITORING: Activity,
    ANALYTICS: BarChart3,
    SECURITY: Shield,
    CUSTOM: Puzzle
};

const CATEGORY_COLORS = {
    STORAGE: 'text-blue-600',
    MONITORING: 'text-green-600',
    ANALYTICS: 'text-purple-600',
    SECURITY: 'text-red-600',
    CUSTOM: 'text-gray-600'
};

function PluginOptionInput({
    option,
    value,
    onChange,
    disabled = false
}: {
    option: { type: string; default?: unknown; description: string; options?: string[] };
    value: unknown;
    onChange: (value: unknown) => void;
    disabled?: boolean;
}) {
    switch (option.type) {
        case 'boolean':
            return (
                <Switch
                    checked={Boolean(value)}
                    onCheckedChange={onChange}
                    disabled={disabled}
                />
            );
        case 'number':
            return (
                <Input
                    type="number"
                    value={Number(value || option.default || 0)}
                    onChange={(e) => onChange(Number(e.target.value))}
                    placeholder={option.description}
                    disabled={disabled}
                    className="h-8 text-xs"
                />
            );
        case 'select':
            return (
                <Select
                    value={String(value || option.default)}
                    onValueChange={onChange}
                    disabled={disabled}
                >
                    <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {option.options?.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                                {opt}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            );
        default:
            return (
                <Input
                    value={String(value || '')}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={option.description}
                    disabled={disabled}
                    className="h-8 text-xs"
                />
            );
    }
}

function IndividualPluginBlock({
    pluginBlock,
    onUpdate,
    onRemove,
    onToggle,
    isEditable = false
}: {
    pluginBlock: PluginBlock;
    onUpdate: (pluginBlock: PluginBlock) => void;
    onRemove: () => void;
    onToggle: (enabled: boolean) => void;
    isEditable?: boolean;
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

    const handleOptionChange = useCallback((key: string, value: unknown) => {
        const updatedOptions = { ...pluginBlock.options, [key]: value };
        onUpdate({
            ...pluginBlock,
            options: updatedOptions
        });
    }, [pluginBlock, onUpdate]);

    const handleToggleEnabled = useCallback(() => {
        const newEnabled = !pluginBlock.isEnabled;
        onUpdate({
            ...pluginBlock,
            isEnabled: newEnabled
        });
        onToggle(newEnabled);
    }, [pluginBlock, onUpdate, onToggle]);

    return (
        <Card className={`
      transition-all duration-200 border
      ${pluginBlock.isActive ? 'border-purple-500 bg-purple-50' : 'border-gray-200'}
      ${hasErrors ? 'border-red-300 bg-red-50' : ''}
      ${!pluginBlock.isEnabled ? 'opacity-60' : ''}
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
                                <CategoryIcon className={`h-4 w-4 ${categoryColor}`} />
                                <CardTitle className="text-xs font-medium">
                                    {pluginBlock.plugin.name}
                                </CardTitle>
                                {statusIcon}
                            </div>

                            <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs px-1 py-0">
                                    Priority: {pluginBlock.priority}
                                </Badge>
                                <Switch
                                    checked={pluginBlock.isEnabled}
                                    onCheckedChange={handleToggleEnabled}
                                    disabled={!isEditable}
                                    size="sm"
                                />

                                {isEditable && (
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
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-gray-500">
                            <Badge variant="secondary" className="text-xs">
                                {pluginBlock.category}
                            </Badge>
                            <span>•</span>
                            <span>{pluginBlock.stats.calls} calls</span>
                            {pluginBlock.stats.errors > 0 && (
                                <>
                                    <span>•</span>
                                    <span className="text-red-500">{pluginBlock.stats.errors} errors</span>
                                </>
                            )}
                        </div>

                        {pluginBlock.validationErrors.length > 0 && (
                            <div className="mt-1 text-xs text-red-600">
                                {pluginBlock.validationErrors[0]}
                            </div>
                        )}
                    </CardHeader>
                </CollapsibleTrigger>

                <CollapsibleContent>
                    <CardContent className="pt-0">
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                            <TabsList className="grid w-full grid-cols-3 text-xs">
                                <TabsTrigger value="options" className="flex items-center gap-1">
                                    <Settings className="h-3 w-3" />
                                    Options
                                </TabsTrigger>
                                <TabsTrigger value="stats" className="flex items-center gap-1">
                                    <BarChart3 className="h-3 w-3" />
                                    Stats
                                </TabsTrigger>
                                <TabsTrigger value="info" className="flex items-center gap-1">
                                    <Info className="h-3 w-3" />
                                    Info
                                </TabsTrigger>
                            </TabsList>

                            {/* Plugin Options */}
                            <TabsContent value="options" className="space-y-3 mt-3">
                                {Object.entries(pluginBlock.options).length === 0 ? (
                                    <div className="text-center py-4 text-xs text-gray-500">
                                        <Settings className="h-6 w-6 mx-auto mb-2 opacity-50" />
                                        <p>No configuration options available</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {Object.entries(pluginBlock.options).map(([key, value]) => {
                                            const availablePlugin = AVAILABLE_PLUGINS.find(p => p.name === pluginBlock.plugin.name);
                                            const optionConfig = availablePlugin?.options[key];

                                            if (!optionConfig) return null;

                                            return (
                                                <div key={key} className="space-y-1">
                                                    <Label className="text-xs text-gray-600">
                                                        {key}
                                                    </Label>
                                                    <PluginOptionInput
                                                        option={optionConfig}
                                                        value={value}
                                                        onChange={(newValue) => handleOptionChange(key, newValue)}
                                                        disabled={!isEditable || !pluginBlock.isEnabled}
                                                    />
                                                    <p className="text-xs text-gray-400">{optionConfig.description}</p>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </TabsContent>

                            {/* Plugin Statistics */}
                            <TabsContent value="stats" className="space-y-3 mt-3">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <Activity className="h-4 w-4 text-green-600" />
                                            <Label className="text-xs">Total Calls</Label>
                                        </div>
                                        <div className="text-lg font-semibold text-green-600">
                                            {pluginBlock.stats.calls}
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <AlertCircle className="h-4 w-4 text-red-600" />
                                            <Label className="text-xs">Errors</Label>
                                        </div>
                                        <div className="text-lg font-semibold text-red-600">
                                            {pluginBlock.stats.errors}
                                        </div>
                                    </div>
                                </div>

                                {pluginBlock.stats.lastActivity && (
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <Clock className="h-4 w-4 text-blue-600" />
                                            <Label className="text-xs">Last Activity</Label>
                                        </div>
                                        <div className="text-xs text-gray-600">
                                            {pluginBlock.stats.lastActivity.toLocaleString()}
                                        </div>
                                    </div>
                                )}

                                {/* Success Rate */}
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <TrendingUp className="h-4 w-4 text-purple-600" />
                                        <Label className="text-xs">Success Rate</Label>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 bg-gray-200 rounded-full h-2">
                                            <div
                                                className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                                                style={{
                                                    width: `${pluginBlock.stats.calls > 0 ?
                                                        ((pluginBlock.stats.calls - pluginBlock.stats.errors) / pluginBlock.stats.calls) * 100 : 0
                                                        }%`
                                                }}
                                            />
                                        </div>
                                        <span className="text-xs text-gray-600">
                                            {pluginBlock.stats.calls > 0 ?
                                                Math.round(((pluginBlock.stats.calls - pluginBlock.stats.errors) / pluginBlock.stats.calls) * 100)
                                                : 0
                                            }%
                                        </span>
                                    </div>
                                </div>
                            </TabsContent>

                            {/* Plugin Info */}
                            <TabsContent value="info" className="space-y-3 mt-3">
                                <div className="space-y-3">
                                    <div>
                                        <Label className="text-xs font-medium">Name</Label>
                                        <p className="text-xs text-gray-600">{pluginBlock.plugin.name}</p>
                                    </div>

                                    <div>
                                        <Label className="text-xs font-medium">Version</Label>
                                        <p className="text-xs text-gray-600">{pluginBlock.plugin.version}</p>
                                    </div>

                                    <div>
                                        <Label className="text-xs font-medium">Category</Label>
                                        <Badge variant="outline" className="text-xs">
                                            {pluginBlock.category}
                                        </Badge>
                                    </div>

                                    <div>
                                        <Label className="text-xs font-medium">Priority</Label>
                                        <p className="text-xs text-gray-600">
                                            {pluginBlock.priority} (Higher numbers execute first)
                                        </p>
                                    </div>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </CardContent>
                </CollapsibleContent>
            </Collapsible>
        </Card>
    );
}

export function PluginContainerBlock({
    plugins,
    isEditable = false,
    onPluginsChange,
    onPluginAdd,
    onPluginRemove,
    onPluginToggle,
    className = '',
    maxHeight = '400px'
}: PluginContainerBlockProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [filterCategory, setFilterCategory] = useState<string>('all');
    const [showPluginLibrary, setShowPluginLibrary] = useState(false);

    // Filter available plugins
    const filteredAvailablePlugins = useMemo(() => {
        return AVAILABLE_PLUGINS.filter(plugin => {
            const matchesSearch = plugin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                plugin.description.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesCategory = filterCategory === 'all' || plugin.category === filterCategory;
            return matchesSearch && matchesCategory;
        });
    }, [searchQuery, filterCategory]);

    // Handle plugin updates
    const handlePluginUpdate = useCallback((updatedPlugin: PluginBlock) => {
        const updatedPlugins = plugins.map(plugin =>
            plugin.id === updatedPlugin.id ? updatedPlugin : plugin
        );
        onPluginsChange(updatedPlugins);
    }, [plugins, onPluginsChange]);

    // Handle plugin removal
    const handlePluginRemove = useCallback((pluginId: string) => {
        const updatedPlugins = plugins.filter(plugin => plugin.id !== pluginId);
        onPluginsChange(updatedPlugins);
        onPluginRemove?.(pluginId);
    }, [plugins, onPluginsChange, onPluginRemove]);

    // Handle plugin toggle
    const handlePluginToggle = useCallback((pluginId: string, enabled: boolean) => {
        onPluginToggle?.(pluginId, enabled);
    }, [onPluginToggle]);

    // Add new plugin
    const handleAddPlugin = useCallback((pluginName: string) => {
        const pluginDefinition = AVAILABLE_PLUGINS.find(p => p.name === pluginName);
        if (!pluginDefinition) return;

        const newPlugin: PluginBlock = {
            id: `plugin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            plugin: {
                name: pluginDefinition.name,
                version: '1.0.0',
                initialize: async () => { },
                dispose: async () => { }
            } as BasePlugin,
            isActive: false,
            isEnabled: true,
            category: pluginDefinition.category,
            priority: pluginDefinition.priority,
            options: Object.fromEntries(
                Object.entries(pluginDefinition.options).map(([key, config]) => [key, config.default])
            ),
            stats: {
                calls: 0,
                errors: 0
            },
            validationErrors: []
        };

        onPluginsChange([...plugins, newPlugin]);
        onPluginAdd?.(pluginName);
        setShowPluginLibrary(false);
    }, [plugins, onPluginsChange, onPluginAdd]);

    return (
        <Card className={`${className}`}>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Puzzle className="h-5 w-5 text-purple-600" />
                        <CardTitle className="text-sm font-semibold">
                            Plugins ({plugins.length})
                        </CardTitle>
                    </div>

                    {isEditable && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setShowPluginLibrary(!showPluginLibrary)}
                            className="h-7 px-2 text-xs"
                        >
                            <Plus className="h-3 w-3 mr-1" />
                            Add Plugin
                        </Button>
                    )}
                </div>

                {/* Plugin Library */}
                {showPluginLibrary && (
                    <div className="mt-3 p-3 border border-gray-200 rounded-lg bg-gray-50">
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Search className="h-4 w-4 text-gray-400" />
                                <Input
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search plugins..."
                                    className="h-8 text-xs flex-1"
                                />
                                <Select value={filterCategory} onValueChange={setFilterCategory}>
                                    <SelectTrigger className="h-8 w-32 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Categories</SelectItem>
                                        <SelectItem value="STORAGE">Storage</SelectItem>
                                        <SelectItem value="MONITORING">Monitoring</SelectItem>
                                        <SelectItem value="ANALYTICS">Analytics</SelectItem>
                                        <SelectItem value="SECURITY">Security</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <ScrollArea className="h-32">
                                <div className="space-y-2">
                                    {filteredAvailablePlugins.map((plugin) => {
                                        const CategoryIcon = CATEGORY_ICONS[plugin.category] || Puzzle;
                                        const categoryColor = CATEGORY_COLORS[plugin.category] || 'text-gray-600';

                                        return (
                                            <div
                                                key={plugin.name}
                                                className="flex items-center justify-between p-2 bg-white rounded border hover:bg-gray-50 cursor-pointer"
                                                onClick={() => handleAddPlugin(plugin.name)}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <CategoryIcon className={`h-4 w-4 ${categoryColor}`} />
                                                    <div>
                                                        <p className="text-xs font-medium">{plugin.name}</p>
                                                        <p className="text-xs text-gray-500">{plugin.description}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Badge variant="outline" className="text-xs">
                                                        {plugin.category}
                                                    </Badge>
                                                    <Plus className="h-3 w-3 text-gray-400" />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </ScrollArea>
                        </div>
                    </div>
                )}
            </CardHeader>

            <CardContent className="pt-0">
                {plugins.length === 0 ? (
                    <div className="text-center py-6 text-xs text-gray-500">
                        <Puzzle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No plugins configured</p>
                        {isEditable && (
                            <p className="mt-1">Click "Add Plugin" to get started</p>
                        )}
                    </div>
                ) : (
                    <ScrollArea style={{ maxHeight }} className="w-full">
                        <div className="space-y-3">
                            {plugins
                                .sort((a, b) => b.priority - a.priority) // Sort by priority (higher first)
                                .map((pluginBlock) => (
                                    <IndividualPluginBlock
                                        key={pluginBlock.id}
                                        pluginBlock={pluginBlock}
                                        onUpdate={handlePluginUpdate}
                                        onRemove={() => handlePluginRemove(pluginBlock.id)}
                                        onToggle={(enabled) => handlePluginToggle(pluginBlock.id, enabled)}
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