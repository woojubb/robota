'use client';

import type { TUniversalValue } from '@robota-sdk/agent-core';
import { AlertCircle, BarChart3, CheckCircle, Info, Puzzle, Settings } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Card, CardContent } from '../../ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible';
import { Tabs, TabsList, TabsTrigger } from '../../ui/tabs';
import { CATEGORY_COLORS, CATEGORY_ICONS } from '../plugin-container-block-types';
import { PERCENTAGE_MULTIPLIER } from './constants';
import { PluginBlockHeader } from './plugin-block-header';
import { PluginInfoTab } from './plugin-info-tab';
import { PluginOptionsTab } from './plugin-options-tab';
import { PluginStatsTab } from './plugin-stats-tab';
import type { IIndividualPluginBlockProps } from './types';

export function IndividualPluginBlock({
  pluginBlock,
  onUpdate,
  onRemove,
  onToggle,
  isEditable = false,
}: IIndividualPluginBlockProps) {
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

  const handleOptionChange = useCallback(
    (key: string, value: TUniversalValue) => {
      onUpdate({ ...pluginBlock, options: { ...pluginBlock.options, [key]: value } });
    },
    [pluginBlock, onUpdate],
  );

  const handleToggleEnabled = useCallback(() => {
    const nextEnabled = !pluginBlock.isEnabled;
    onUpdate({ ...pluginBlock, isEnabled: nextEnabled });
    onToggle(nextEnabled);
  }, [pluginBlock, onUpdate, onToggle]);

  const successRate =
    pluginBlock.stats.calls > 0
      ? Math.round(
          ((pluginBlock.stats.calls - pluginBlock.stats.errors) / pluginBlock.stats.calls) *
            PERCENTAGE_MULTIPLIER,
        )
      : 0;

  return (
    <Card
      className={`transition-all duration-200 border ${pluginBlock.isActive ? 'border-purple-500 bg-purple-50' : 'border-gray-200'} ${hasErrors ? 'border-red-300 bg-red-50' : ''} ${!pluginBlock.isEnabled ? 'opacity-60' : ''}`}
    >
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <PluginBlockHeader
            pluginBlock={pluginBlock}
            isExpanded={isExpanded}
            hasErrors={hasErrors}
            categoryColor={categoryColor}
            CategoryIcon={CategoryIcon}
            statusIcon={statusIcon}
            isEditable={isEditable}
            onToggleEnabled={handleToggleEnabled}
            onRemove={onRemove}
          />
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
              <PluginOptionsTab
                pluginBlock={pluginBlock}
                isEditable={isEditable}
                onOptionChange={handleOptionChange}
              />
              <PluginStatsTab stats={pluginBlock.stats} successRate={successRate} />
              <PluginInfoTab pluginBlock={pluginBlock} />
            </Tabs>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
