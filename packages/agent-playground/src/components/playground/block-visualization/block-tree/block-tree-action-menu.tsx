import React from 'react';
import { MoreVertical, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '../../../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../ui/dropdown-menu';
import type { IBlockTreeActionMenuProps } from './types';

export const BlockTreeActionMenu: React.FC<IBlockTreeActionMenuProps> = ({
  onRefresh,
  onExpandAll,
  onCollapseAll,
  onClearBlocks,
}) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8">
          <MoreVertical className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onRefresh}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onExpandAll}>Expand All</DropdownMenuItem>
        <DropdownMenuItem onClick={onCollapseAll}>Collapse All</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClearBlocks} className="text-red-600">
          <Trash2 className="w-4 h-4 mr-2" />
          Clear All
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
