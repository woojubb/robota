import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { TUniversalValue } from '@robota-sdk/agent-core';

import type { IToolBlock, IToolContainerBlockProps } from '../tool-container-block-types';
import { createToolBlock, filterAvailableTools } from './create-tool-block';

type TToolContainerStateInput = Pick<
  IToolContainerBlockProps,
  'tools' | 'onToolsChange' | 'onToolAdd' | 'onToolRemove' | 'onToolExecute'
>;

interface IToolContainerActionsInput extends TToolContainerStateInput {
  setShowToolLibrary: Dispatch<SetStateAction<boolean>>;
}

function useToolContainerActions({
  tools,
  onToolsChange,
  onToolAdd,
  onToolRemove,
  onToolExecute,
  setShowToolLibrary,
}: IToolContainerActionsInput) {
  const handleToolUpdate = useCallback(
    (updatedTool: IToolBlock) => {
      onToolsChange(tools.map((tool) => (tool.id === updatedTool.id ? updatedTool : tool)));
    },
    [tools, onToolsChange],
  );

  const handleToolRemove = useCallback(
    (toolId: string) => {
      onToolsChange(tools.filter((tool) => tool.id !== toolId));
      onToolRemove?.(toolId);
    },
    [tools, onToolsChange, onToolRemove],
  );

  const handleToolExecute = useCallback(
    (toolId: string, parameters: Record<string, TUniversalValue>) => {
      onToolExecute?.(toolId, parameters);
    },
    [onToolExecute],
  );

  const handleAddTool = useCallback(
    (toolName: string) => {
      const newTool = createToolBlock(toolName);
      if (!newTool) return;
      onToolsChange([...tools, newTool]);
      onToolAdd?.(toolName);
      setShowToolLibrary(false);
    },
    [tools, onToolsChange, onToolAdd],
  );

  return {
    handleToolUpdate,
    handleToolRemove,
    handleToolExecute,
    handleAddTool,
  };
}

export function useToolContainerState(input: TToolContainerStateInput) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showToolLibrary, setShowToolLibrary] = useState(false);
  const filteredAvailableTools = useMemo(() => filterAvailableTools(searchQuery), [searchQuery]);
  const actions = useToolContainerActions({ ...input, setShowToolLibrary });

  return {
    searchQuery,
    showToolLibrary,
    filteredAvailableTools,
    setSearchQuery,
    setShowToolLibrary,
    ...actions,
  };
}
