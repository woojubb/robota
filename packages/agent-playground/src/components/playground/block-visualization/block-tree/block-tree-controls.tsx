import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '../../../ui/button';
import { BlockTreeActionMenu } from './block-tree-action-menu';
import { BlockTreeStatsBadges } from './block-tree-stats-badges';
import type { IBlockTreeControlsProps } from './types';

export const BlockTreeControls: React.FC<IBlockTreeControlsProps> = ({
  stats,
  localShowDebug,
  onToggleDebug,
  onRefresh,
  onExpandAll,
  onCollapseAll,
  onClearBlocks,
}) => {
  return (
    <div className="flex items-center justify-between p-3 border-b bg-gray-50">
      <BlockTreeStatsBadges stats={stats} />

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onToggleDebug} className="h-8">
          {localShowDebug ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </Button>
        <BlockTreeActionMenu
          onRefresh={onRefresh}
          onExpandAll={onExpandAll}
          onCollapseAll={onCollapseAll}
          onClearBlocks={onClearBlocks}
        />
      </div>
    </div>
  );
};
