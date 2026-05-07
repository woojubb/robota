import { Card, CardContent } from '../../ui/card';
import { type IToolContainerBlockProps, getMaxHeightClass } from '../tool-container-block-types';
import { ToolContainerContent } from './tool-container-content';
import { ToolContainerHeader } from './tool-container-header';
import { useToolContainerState } from './use-tool-container-state';

export function ToolContainerBlock({
  tools,
  isEditable = false,
  onToolsChange,
  onToolAdd,
  onToolRemove,
  onToolExecute,
  className = '',
  maxHeight = '400px',
}: IToolContainerBlockProps) {
  const state = useToolContainerState({
    tools,
    onToolsChange,
    onToolAdd,
    onToolRemove,
    onToolExecute,
  });

  return (
    <Card className={`${className}`}>
      <ToolContainerHeader
        toolCount={tools.length}
        isEditable={isEditable}
        showToolLibrary={state.showToolLibrary}
        searchQuery={state.searchQuery}
        filteredAvailableTools={state.filteredAvailableTools}
        onToggleToolLibrary={() => state.setShowToolLibrary(!state.showToolLibrary)}
        onSearchQueryChange={state.setSearchQuery}
        onAddTool={state.handleAddTool}
      />
      <CardContent className="pt-0">
        <ToolContainerContent
          tools={tools}
          maxHeightClassName={getMaxHeightClass(maxHeight)}
          isEditable={isEditable}
          onToolUpdate={state.handleToolUpdate}
          onToolRemove={state.handleToolRemove}
          onToolExecute={state.handleToolExecute}
        />
      </CardContent>
    </Card>
  );
}
