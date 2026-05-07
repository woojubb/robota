'use client';

import type { TUniversalValue } from '@robota-sdk/agent-core';
import { Settings } from 'lucide-react';

import { Label } from '../../ui/label';
import { TabsContent } from '../../ui/tabs';
import { AVAILABLE_PLUGINS, type IPluginBlock } from '../plugin-container-block-types';
import { PluginOptionInput } from './plugin-option-input';

interface IPluginOptionsTabProps {
  pluginBlock: IPluginBlock;
  isEditable: boolean;
  onOptionChange: (key: string, value: TUniversalValue) => void;
}

export function PluginOptionsTab({
  pluginBlock,
  isEditable,
  onOptionChange,
}: IPluginOptionsTabProps) {
  return (
    <TabsContent value="options" className="space-y-3 mt-3">
      {Object.entries(pluginBlock.options).length === 0 ? (
        <div className="text-center py-4 text-xs text-gray-500">
          <Settings className="h-6 w-6 mx-auto mb-2 opacity-50" />
          <p>No configuration options available</p>
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(pluginBlock.options).map(([key, value]) => {
            const availablePlugin = AVAILABLE_PLUGINS.find(
              (plugin) => plugin.name === pluginBlock.plugin.name,
            );
            const optionConfig =
              availablePlugin?.options[key as keyof typeof availablePlugin.options];
            if (!optionConfig) return null;
            return (
              <div key={key} className="space-y-1">
                <Label className="text-xs text-gray-600">{key}</Label>
                <PluginOptionInput
                  option={optionConfig}
                  value={value}
                  onChange={(newValue) => onOptionChange(key, newValue)}
                  disabled={!isEditable || !pluginBlock.isEnabled}
                />
                <p className="text-xs text-gray-400">{optionConfig.description}</p>
              </div>
            );
          })}
        </div>
      )}
    </TabsContent>
  );
}
