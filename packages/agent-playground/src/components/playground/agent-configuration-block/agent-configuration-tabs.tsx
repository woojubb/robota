import { Brain, Puzzle, Settings, Zap } from 'lucide-react';

import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import { ModelConfigurationTab } from './model-configuration-tab';
import { PluginsConfigurationTab } from './plugins-configuration-tab';
import { SettingsConfigurationTab } from './settings-configuration-tab';
import { ToolsConfigurationTab } from './tools-configuration-tab';
import type { TAgentConfigUpdateHandler } from './types';

interface IAgentConfigurationTabsProps {
  config: IPlaygroundAgentConfig;
  isExecuting: boolean;
  onConfigUpdate: TAgentConfigUpdateHandler;
}

export function AgentConfigurationTabs({
  config,
  isExecuting,
  onConfigUpdate,
}: IAgentConfigurationTabsProps) {
  return (
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

      <TabsContent value="model" className="space-y-3 mt-3">
        <ModelConfigurationTab
          config={config}
          isExecuting={isExecuting}
          onConfigUpdate={onConfigUpdate}
        />
      </TabsContent>

      <TabsContent value="tools" className="space-y-3 mt-3">
        <ToolsConfigurationTab config={config} />
      </TabsContent>

      <TabsContent value="plugins" className="space-y-3 mt-3">
        <PluginsConfigurationTab config={config} />
      </TabsContent>

      <TabsContent value="settings" className="space-y-3 mt-3">
        <SettingsConfigurationTab
          config={config}
          isExecuting={isExecuting}
          onConfigUpdate={onConfigUpdate}
        />
      </TabsContent>
    </Tabs>
  );
}
