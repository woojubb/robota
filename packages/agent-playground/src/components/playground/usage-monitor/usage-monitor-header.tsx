import { Activity, RefreshCw } from 'lucide-react';

import { Button } from '../../ui/button';
import { CardHeader, CardTitle } from '../../ui/card';

export interface IUsageMonitorHeaderProps {
  isLoading: boolean;
  lastUpdate: Date | null;
  onClose?: () => void;
  onRefresh: () => void;
}

export function UsageMonitorHeader({
  isLoading,
  lastUpdate,
  onClose,
  onRefresh,
}: IUsageMonitorHeaderProps) {
  return (
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className="w-5 h-5" />
          Usage Monitor
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              ×
            </Button>
          )}
        </div>
      </div>
      {lastUpdate && (
        <div className="text-xs text-muted-foreground">
          Updated {lastUpdate.toLocaleTimeString()}
        </div>
      )}
    </CardHeader>
  );
}
