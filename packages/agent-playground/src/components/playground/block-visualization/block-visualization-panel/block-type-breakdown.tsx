import React, { useEffect, useState } from 'react';

import { Badge } from '../../../ui/badge';
import type { IPlaygroundBlockCollector } from '../../../../lib/playground/block-tracking';
import { BlockTypeIcon } from './block-type-icon';

interface IBlockTypeBreakdownProps {
  blockCollector: IPlaygroundBlockCollector;
}

export const BlockTypeBreakdown: React.FC<IBlockTypeBreakdownProps> = ({ blockCollector }) => {
  const [stats, setStats] = useState(blockCollector.getStats());

  useEffect(() => {
    const updateStats = () => {
      setStats(blockCollector.getStats());
    };

    blockCollector.addListener(updateStats);
    updateStats();

    return () => {
      blockCollector.removeListener(updateStats);
    };
  }, [blockCollector]);

  return (
    <div className="space-y-3 p-4">
      {Object.entries(stats.byType).map(([type, count]) => (
        <div key={type} className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <BlockTypeIcon type={type} />
            <span className="text-sm font-medium capitalize">{type.replace('_', ' ')}</span>
          </div>
          <Badge variant="secondary">{count}</Badge>
        </div>
      ))}
    </div>
  );
};
