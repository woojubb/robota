import { Activity, GitBranch, RotateCcw } from 'lucide-react';

import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { MS_PER_SECOND } from './constants';
import type { IExecutionTreeStats } from './execution-stats';

interface IExecutionTreeHeaderProps {
  stats: IExecutionTreeStats;
  onClearBlocks: () => void;
}

export function ExecutionTreeHeader({ stats, onClearBlocks }: IExecutionTreeHeaderProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center space-x-2">
            <GitBranch className="w-5 h-5" />
            <span>Execution Tree</span>
          </CardTitle>
          <div className="flex items-center space-x-2">
            <ExecutionStatsBadges stats={stats} />
            <Button variant="outline" size="sm" onClick={onClearBlocks} className="text-xs">
              <RotateCcw className="w-3 h-3 mr-1" />
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>

      {stats.completed > 0 && (
        <CardContent className="pt-0">
          <div className="flex items-center space-x-4 text-xs text-gray-600">
            <span>Total Duration: {(stats.totalDuration / MS_PER_SECOND).toFixed(1)}s</span>
            <span>Avg Duration: {(stats.avgDuration / MS_PER_SECOND).toFixed(1)}s</span>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function ExecutionStatsBadges({ stats }: { stats: IExecutionTreeStats }) {
  return (
    <div className="flex items-center space-x-2 text-sm">
      <Badge variant="outline" className="space-x-1">
        <Activity className="w-3 h-3" />
        <span>{stats.total}</span>
      </Badge>

      {stats.inProgress > 0 && (
        <Badge variant="default" className="bg-blue-500">
          {stats.inProgress} active
        </Badge>
      )}
      {stats.completed > 0 && (
        <Badge variant="default" className="bg-green-500">
          {stats.completed} done
        </Badge>
      )}
      {stats.error > 0 && <Badge variant="destructive">{stats.error} failed</Badge>}
    </div>
  );
}
