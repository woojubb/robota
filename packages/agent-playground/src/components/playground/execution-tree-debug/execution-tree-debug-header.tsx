import { GitBranch, Play, RefreshCw, RotateCcw, Zap } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import type { IExecutionTreeDebugStats } from './types';

interface IExecutionTreeDebugHeaderProps {
  stats: IExecutionTreeDebugStats;
  lastRefresh: number;
  isClient: boolean;
  refreshInterval: number;
  onGenerateDemo: () => void;
  onGenerateComplexDemo: () => void;
  onRefresh: () => void;
  onClear: () => void;
}

interface IDebugControlButtonsProps {
  onGenerateDemo: () => void;
  onGenerateComplexDemo: () => void;
  onRefresh: () => void;
  onClear: () => void;
}

export function ExecutionTreeDebugHeader({
  stats,
  lastRefresh,
  isClient,
  refreshInterval,
  onGenerateDemo,
  onGenerateComplexDemo,
  onRefresh,
  onClear,
}: IExecutionTreeDebugHeaderProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center space-x-2">
            <GitBranch className="w-5 h-5" />
            <span>Execution Tree Debug</span>
          </CardTitle>

          <div className="flex items-center space-x-2">
            <DebugStatsBadges stats={stats} />
            <DebugControlButtons
              onGenerateDemo={onGenerateDemo}
              onGenerateComplexDemo={onGenerateComplexDemo}
              onRefresh={onRefresh}
              onClear={onClear}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="text-xs text-gray-600">
          Last updated: {isClient ? new Date(lastRefresh).toLocaleTimeString() : '--:--:--'}
          {refreshInterval > 0 && ` (auto-refresh every ${refreshInterval}ms)`}
        </div>
      </CardContent>
    </Card>
  );
}

function DebugControlButtons({
  onGenerateDemo,
  onGenerateComplexDemo,
  onRefresh,
  onClear,
}: IDebugControlButtonsProps) {
  return (
    <>
      <Button onClick={onGenerateDemo} size="sm" className="text-xs bg-blue-500 hover:bg-blue-600">
        <Play className="w-3 h-3 mr-1" />
        Generate Demo
      </Button>

      <Button onClick={onGenerateComplexDemo} variant="outline" size="sm" className="text-xs">
        <Zap className="w-3 h-3 mr-1" />
        Complex Demo
      </Button>

      <Button variant="outline" size="sm" onClick={onRefresh} className="text-xs">
        <RefreshCw className="w-3 h-3 mr-1" />
        Refresh
      </Button>

      <Button variant="outline" size="sm" onClick={onClear} className="text-xs">
        <RotateCcw className="w-3 h-3 mr-1" />
        Clear
      </Button>
    </>
  );
}

function DebugStatsBadges({ stats }: { stats: IExecutionTreeDebugStats }) {
  return (
    <div className="flex items-center space-x-2 text-sm">
      <Badge variant="outline">{stats.totalBlocks} blocks</Badge>
      <Badge variant="outline">{stats.rootNodes} roots</Badge>

      {stats.inProgress > 0 && <Badge className="bg-blue-500">{stats.inProgress} active</Badge>}

      {stats.completed > 0 && <Badge className="bg-green-500">{stats.completed} done</Badge>}

      {stats.error > 0 && <Badge variant="destructive">{stats.error} failed</Badge>}
    </div>
  );
}
