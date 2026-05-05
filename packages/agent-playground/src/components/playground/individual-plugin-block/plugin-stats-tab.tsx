'use client';

import { Activity, AlertCircle, Clock, TrendingUp } from 'lucide-react';

import { Label } from '../../ui/label';
import { Progress } from '../../ui/progress';
import { TabsContent } from '../../ui/tabs';
import type { IPluginBlock } from '../plugin-container-block-types';

interface IPluginStatsTabProps {
  stats: IPluginBlock['stats'];
  successRate: number;
}

export function PluginStatsTab({ stats, successRate }: IPluginStatsTabProps) {
  return (
    <TabsContent value="stats" className="space-y-3 mt-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-green-600" />
            <Label className="text-xs">Total Calls</Label>
          </div>
          <div className="text-lg font-semibold text-green-600">{stats.calls}</div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <Label className="text-xs">Errors</Label>
          </div>
          <div className="text-lg font-semibold text-red-600">{stats.errors}</div>
        </div>
      </div>
      {stats.lastActivity && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-blue-600" />
            <Label className="text-xs">Last Activity</Label>
          </div>
          <div className="text-xs text-gray-600">{stats.lastActivity.toLocaleString()}</div>
        </div>
      )}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-purple-600" />
          <Label className="text-xs">Success Rate</Label>
        </div>
        <div className="flex items-center gap-2">
          <Progress value={successRate} className="h-2 flex-1" />
          <span className="text-xs text-gray-600">{successRate}%</span>
        </div>
      </div>
    </TabsContent>
  );
}
