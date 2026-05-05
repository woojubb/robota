import React from 'react';
import type { LucideIcon } from 'lucide-react';

import { Card, CardContent } from '../../../ui/card';

interface IBlockStatCardProps {
  icon: LucideIcon;
  iconClassName: string;
  value: number;
  label: string;
}

export const BlockStatCard: React.FC<IBlockStatCardProps> = ({
  icon: Icon,
  iconClassName,
  value,
  label,
}) => {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center space-x-2">
          <Icon className={`w-4 h-4 ${iconClassName}`} />
          <div>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs text-gray-500">{label}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
