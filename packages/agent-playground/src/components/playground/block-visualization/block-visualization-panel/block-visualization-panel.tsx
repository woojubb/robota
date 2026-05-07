import React, { useCallback, useState } from 'react';

import { Card, CardContent } from '../../../ui/card';
import type { IBlockMessage } from '../../../../lib/playground/block-tracking';
import { BlockVisualizationHeader } from './block-visualization-header';
import { BlockVisualizationTabs } from './block-visualization-tabs';
import { getContainerHeightClass } from './container-height-class';
import type { IBlockVisualizationPanelProps } from './types';

/**
 * Main Block Visualization Panel Component.
 * Provides complete block coding visualization with statistics and inspection.
 */
export const BlockVisualizationPanel: React.FC<IBlockVisualizationPanelProps> = ({
  blockCollector,
  height = '600px',
  showDebug = false,
  autoScroll = true,
  onBlockInspect,
}) => {
  const [selectedBlock, setSelectedBlock] = useState<IBlockMessage | null>(null);
  const [activeTab, setActiveTab] = useState<string>('tree');
  const containerHeightClassName = getContainerHeightClass(height);

  const handleBlockSelect = useCallback(
    (block: IBlockMessage) => {
      setSelectedBlock(block);
      onBlockInspect?.(block);

      if (activeTab !== 'tree') {
        setActiveTab('inspect');
      }
    },
    [onBlockInspect, activeTab],
  );

  const handleCloseInspection = useCallback(() => {
    setSelectedBlock(null);
  }, []);

  return (
    <Card className="flex flex-col h-full">
      <BlockVisualizationHeader />

      <CardContent className="flex-1 p-0">
        <BlockVisualizationTabs
          activeTab={activeTab}
          containerHeightClassName={containerHeightClassName}
          blockCollector={blockCollector}
          showDebug={showDebug}
          autoScroll={autoScroll}
          selectedBlock={selectedBlock}
          onActiveTabChange={setActiveTab}
          onBlockSelect={handleBlockSelect}
          onCloseInspection={handleCloseInspection}
        />
      </CardContent>
    </Card>
  );
};
