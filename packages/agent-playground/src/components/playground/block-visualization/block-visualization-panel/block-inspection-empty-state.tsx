import React from 'react';
import { Clock } from 'lucide-react';

export const BlockInspectionEmptyState: React.FC = () => {
  return (
    <div className="p-4 text-center text-gray-500">
      <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
      <div className="text-sm">Select a block to inspect</div>
    </div>
  );
};
