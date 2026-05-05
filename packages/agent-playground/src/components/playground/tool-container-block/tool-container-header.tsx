import { Plus, Zap } from 'lucide-react';

import { Button } from '../../ui/button';
import { CardHeader, CardTitle } from '../../ui/card';
import type { AVAILABLE_TOOLS } from '../tool-container-block-types';
import { ToolLibrary } from './tool-library';

type TAvailableTool = (typeof AVAILABLE_TOOLS)[number];

interface IToolContainerHeaderProps {
  toolCount: number;
  isEditable: boolean;
  showToolLibrary: boolean;
  searchQuery: string;
  filteredAvailableTools: TAvailableTool[];
  onToggleToolLibrary: () => void;
  onSearchQueryChange: (searchQuery: string) => void;
  onAddTool: (toolName: string) => void;
}

export function ToolContainerHeader({
  toolCount,
  isEditable,
  showToolLibrary,
  searchQuery,
  filteredAvailableTools,
  onToggleToolLibrary,
  onSearchQueryChange,
  onAddTool,
}: IToolContainerHeaderProps) {
  return (
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-orange-600" />
          <CardTitle className="text-sm font-semibold">Tools ({toolCount})</CardTitle>
        </div>
        {isEditable && (
          <Button
            size="sm"
            variant="outline"
            onClick={onToggleToolLibrary}
            className="h-7 px-2 text-xs"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Tool
          </Button>
        )}
      </div>
      {showToolLibrary && (
        <ToolLibrary
          searchQuery={searchQuery}
          filteredAvailableTools={filteredAvailableTools}
          onSearchQueryChange={onSearchQueryChange}
          onAddTool={onAddTool}
        />
      )}
    </CardHeader>
  );
}
