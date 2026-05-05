import React from 'react';
import { Badge } from '../../../ui/badge';
import type { IBlockTreeStatsBadgesProps } from './types';

export const BlockTreeStatsBadges: React.FC<IBlockTreeStatsBadgesProps> = ({ stats }) => {
  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="text-xs">
        {stats.total} blocks
      </Badge>
      {stats.byState.in_progress > 0 && (
        <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">
          {stats.byState.in_progress} running
        </Badge>
      )}
      {stats.byState.error > 0 && (
        <Badge variant="destructive" className="text-xs">
          {stats.byState.error} errors
        </Badge>
      )}
    </div>
  );
};
