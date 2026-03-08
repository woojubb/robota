'use client';

const RANDOM_ID_BASE = 36;
const RANDOM_ID_LENGTH = 9;

/**
 * PluginContainerBlock - Visual Plugin Configuration Component
 *
 * Provides a visual block-coding style representation of
 * Plugins within an Agent configuration in the Playground interface.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ScrollArea } from '../ui/scroll-area';
import { Puzzle, Plus, Search } from 'lucide-react';
import type { TUniversalValue } from '@robota-sdk/agents';

// Re-export types for external consumers
export {
    PLUGIN_CATEGORIES,
    PLUGIN_PRIORITIES,
    type TPluginCategory,
    type TPluginPriority,
    type IPlaygroundPluginStats,
    type IPluginBlock,
    type IPluginContainerBlockProps
} from './plugin-container-block-types';

import {
    PLUGIN_CATEGORIES,
    AVAILABLE_PLUGINS,
    CATEGORY_ICONS,
    CATEGORY_COLORS,
    isPluginCategoryKey,
    getMaxHeightClass,
    type TPluginCategory,
    type IPluginBlock,
    type IPluginContainerBlockProps
} from './plugin-container-block-types';
import { IndividualPluginBlock } from './individual-plugin-block';

export function PluginContainerBlock({
    plugins,
    isEditable = false,
    onPluginsChange,
    onPluginAdd,
    onPluginRemove,
    onPluginToggle,
    className = '',
    maxHeight = '400px'
}: IPluginContainerBlockProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [filterCategory, setFilterCategory] = useState<TPluginCategory | 'all'>('all');
    const handleFilterCategoryChange = useCallback((value: string) => {
        if (value === 'all') {
            setFilterCategory('all');
            return;
        }
        if (!isPluginCategoryKey(value)) {
            throw new Error(`[PLAYGROUND] Invalid plugin category filter value: "${value}"`);
        }
        setFilterCategory(PLUGIN_CATEGORIES[value]);
    }, []);
    const [showPluginLibrary, setShowPluginLibrary] = useState(false);
    const maxHeightClassName = getMaxHeightClass(maxHeight);

    const filteredAvailablePlugins = useMemo(() => {
        return AVAILABLE_PLUGINS.filter(plugin => {
            const matchesSearch = plugin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                plugin.description.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesCategory = filterCategory === 'all' || plugin.category === filterCategory;
            return matchesSearch && matchesCategory;
        });
    }, [searchQuery, filterCategory]);

    const handlePluginUpdate = useCallback((updatedPlugin: IPluginBlock) => {
        const updatedPlugins = plugins.map(plugin =>
            plugin.id === updatedPlugin.id ? updatedPlugin : plugin
        );
        onPluginsChange(updatedPlugins);
    }, [plugins, onPluginsChange]);

    const handlePluginRemove = useCallback((pluginId: string) => {
        const updatedPlugins = plugins.filter(plugin => plugin.id !== pluginId);
        onPluginsChange(updatedPlugins);
        onPluginRemove?.(pluginId);
    }, [plugins, onPluginsChange, onPluginRemove]);

    const handlePluginToggle = useCallback((pluginId: string, enabled: boolean) => {
        onPluginToggle?.(pluginId, enabled);
    }, [onPluginToggle]);

    const handleAddPlugin = useCallback((pluginName: string) => {
        const pluginDefinition = AVAILABLE_PLUGINS.find(p => p.name === pluginName);
        if (!pluginDefinition) return;

        const options: Record<string, TUniversalValue> = {};
        for (const [key, config] of Object.entries(pluginDefinition.options)) {
            options[key] = config.default;
        }

        const newPlugin: IPluginBlock = {
            id: `plugin_${Date.now()}_${Math.random().toString(RANDOM_ID_BASE).substr(2, RANDOM_ID_LENGTH)}`,
            plugin: {
                name: pluginDefinition.name,
                version: '1.0.0',
                initialize: async () => { },
                dispose: async () => { }
            },
            isActive: false,
            isEnabled: true,
            category: pluginDefinition.category,
            priority: pluginDefinition.priority,
            options,
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
                                <Select value={filterCategory} onValueChange={handleFilterCategoryChange}>
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
                    <ScrollArea className={`w-full ${maxHeightClassName}`}>
                        <div className="space-y-3">
                            {plugins
                                .sort((a, b) => b.priority - a.priority)
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
