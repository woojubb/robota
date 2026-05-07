import React from 'react';
import { Activity, AlertTriangle, BarChart3, Settings, Users, Zap } from 'lucide-react';

import type { IBlockMetadata } from '../../../../lib/playground/block-tracking/types';

interface IBlockTypeIconProps {
  type: string;
}

export const BlockTypeIcon: React.FC<IBlockTypeIconProps> = ({ type }) => {
  const typeIcons: Partial<Record<IBlockMetadata['type'], React.ReactNode>> = {
    user: <Users className="w-4 h-4" />,
    assistant: <Activity className="w-4 h-4" />,
    tool_call: <Settings className="w-4 h-4" />,
    tool_result: <Zap className="w-4 h-4" />,
    error: <AlertTriangle className="w-4 h-4" />,
    group: <BarChart3 className="w-4 h-4" />,
  };

  return <>{typeIcons[type as IBlockMetadata['type']]}</>;
};
