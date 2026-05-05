import React from 'react';

import { BlockTree } from '../block-tree';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../ui/tabs';
import type {
  IBlockMessage,
  IPlaygroundBlockCollector,
} from '../../../../lib/playground/block-tracking';
import { ExecutionTreeDebug } from '../../execution-tree-debug';
import { BlockInspectionPanel } from './block-inspection-panel';
import { BlockStats } from './block-stats';
import { BlockTypeBreakdown } from './block-type-breakdown';

interface IBlockVisualizationTabsProps {
  activeTab: string;
  containerHeightClassName: string;
  blockCollector: IPlaygroundBlockCollector;
  showDebug: boolean;
  autoScroll: boolean;
  selectedBlock: IBlockMessage | null;
  onActiveTabChange: (activeTab: string) => void;
  onBlockSelect: (block: IBlockMessage) => void;
  onCloseInspection: () => void;
}

const BlockVisualizationTabList: React.FC = () => {
  return (
    <TabsList className="grid w-full grid-cols-5 mx-3 mb-0">
      <TabsTrigger value="tree">Tree</TabsTrigger>
      <TabsTrigger value="stats">Stats</TabsTrigger>
      <TabsTrigger value="types">Types</TabsTrigger>
      <TabsTrigger value="debug">Debug</TabsTrigger>
      <TabsTrigger value="inspect">Inspect</TabsTrigger>
    </TabsList>
  );
};

const ScrollableTabPanel: React.FC<React.PropsWithChildren> = ({ children }) => {
  return <div className="h-full overflow-y-auto">{children}</div>;
};

const DebugTabPanel: React.FC<{ blockCollector: IPlaygroundBlockCollector }> = ({
  blockCollector,
}) => {
  return (
    <div className="h-full overflow-y-auto p-3">
      <ExecutionTreeDebug blockCollector={blockCollector} refreshInterval={1000} />
    </div>
  );
};

export const BlockVisualizationTabs: React.FC<IBlockVisualizationTabsProps> = ({
  activeTab,
  containerHeightClassName,
  blockCollector,
  showDebug,
  autoScroll,
  selectedBlock,
  onActiveTabChange,
  onBlockSelect,
  onCloseInspection,
}) => {
  return (
    <Tabs value={activeTab} onValueChange={onActiveTabChange} className="h-full flex flex-col">
      <BlockVisualizationTabList />

      <div className={`flex-1 ${containerHeightClassName}`}>
        <TabsContent value="tree" className="h-full m-0">
          <BlockTree
            blockCollector={blockCollector}
            height="100%"
            showDebug={showDebug}
            autoScroll={autoScroll}
            onBlockSelect={onBlockSelect}
            selectedBlockId={selectedBlock?.blockMetadata.id}
            showControls={true}
          />
        </TabsContent>

        <TabsContent value="stats" className="h-full m-0">
          <ScrollableTabPanel>
            <BlockStats blockCollector={blockCollector} />
          </ScrollableTabPanel>
        </TabsContent>

        <TabsContent value="types" className="h-full m-0">
          <ScrollableTabPanel>
            <BlockTypeBreakdown blockCollector={blockCollector} />
          </ScrollableTabPanel>
        </TabsContent>

        <TabsContent value="debug" className="h-full m-0">
          <DebugTabPanel blockCollector={blockCollector} />
        </TabsContent>

        <TabsContent value="inspect" className="h-full m-0">
          <ScrollableTabPanel>
            <BlockInspectionPanel selectedBlock={selectedBlock} onClose={onCloseInspection} />
          </ScrollableTabPanel>
        </TabsContent>
      </div>
    </Tabs>
  );
};
