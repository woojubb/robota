import React from 'react';
import { Activity } from 'lucide-react';

import { Badge } from '../../../ui/badge';
import { CardHeader, CardTitle } from '../../../ui/card';

export const BlockVisualizationHeader: React.FC = () => {
  return (
    <CardHeader className="pb-3">
      <CardTitle className="flex items-center gap-2">
        <Activity className="w-5 h-5 text-blue-500" />
        Block Visualization
        <Badge variant="outline" className="ml-auto">
          Real-time
        </Badge>
        <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
          Try Debug Tab!
        </Badge>
      </CardTitle>
    </CardHeader>
  );
};
