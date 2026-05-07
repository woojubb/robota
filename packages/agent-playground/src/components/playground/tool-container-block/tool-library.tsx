import { Plus, Search } from 'lucide-react';

import { Input } from '../../ui/input';
import { ScrollArea } from '../../ui/scroll-area';
import type { AVAILABLE_TOOLS } from '../tool-container-block-types';

type TAvailableTool = (typeof AVAILABLE_TOOLS)[number];

interface IToolLibraryProps {
  searchQuery: string;
  filteredAvailableTools: TAvailableTool[];
  onSearchQueryChange: (searchQuery: string) => void;
  onAddTool: (toolName: string) => void;
}

export function ToolLibrary({
  searchQuery,
  filteredAvailableTools,
  onSearchQueryChange,
  onAddTool,
}: IToolLibraryProps) {
  return (
    <div className="mt-3 p-3 border border-gray-200 rounded-lg bg-gray-50">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-gray-400" />
          <Input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Search tools..."
            className="h-8 text-xs"
          />
        </div>
        <ScrollArea className="h-32">
          <div className="space-y-2">
            {filteredAvailableTools.map((tool) => (
              <div
                key={tool.name}
                className="flex items-center justify-between p-2 bg-white rounded border hover:bg-gray-50 cursor-pointer"
                onClick={() => onAddTool(tool.name)}
              >
                <div>
                  <p className="text-xs font-medium">{tool.name}</p>
                  <p className="text-xs text-gray-500">{tool.description}</p>
                </div>
                <Plus className="h-3 w-3 text-gray-400" />
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
