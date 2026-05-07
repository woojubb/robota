'use client';

import { Badge } from '../../ui/badge';
import { Label } from '../../ui/label';
import { TabsContent } from '../../ui/tabs';
import type { IPluginBlock } from '../plugin-container-block-types';

interface IPluginInfoTabProps {
  pluginBlock: IPluginBlock;
}

export function PluginInfoTab({ pluginBlock }: IPluginInfoTabProps) {
  return (
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
  );
}
