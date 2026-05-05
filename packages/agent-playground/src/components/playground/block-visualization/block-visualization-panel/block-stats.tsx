import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, Zap } from 'lucide-react';

import type { IPlaygroundBlockCollector } from '../../../../lib/playground/block-tracking';
import { BlockStatCard } from './block-stat-card';

interface IBlockStatsProps {
  blockCollector: IPlaygroundBlockCollector;
}

export const BlockStats: React.FC<IBlockStatsProps> = ({ blockCollector }) => {
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

  const { total, byState } = stats;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
      <BlockStatCard
        icon={BarChart3}
        iconClassName="text-blue-500"
        value={total}
        label="Total Blocks"
      />
      <BlockStatCard
        icon={Activity}
        iconClassName="text-green-500"
        value={byState.in_progress || 0}
        label="Running"
      />
      <BlockStatCard
        icon={Zap}
        iconClassName="text-yellow-500"
        value={byState.completed || 0}
        label="Completed"
      />
      <BlockStatCard
        icon={AlertTriangle}
        iconClassName="text-red-500"
        value={byState.error || 0}
        label="Errors"
      />
    </div>
  );
};
