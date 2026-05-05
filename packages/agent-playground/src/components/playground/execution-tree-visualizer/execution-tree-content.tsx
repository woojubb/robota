import { ScrollArea } from '../../ui/scroll-area';
import { EmptyExecutionTree } from './empty-execution-tree';
import { ExecutionTreeNodeView } from './execution-tree-node-view';
import type { IRealTimeBlockMessage } from '../../../lib/playground/block-tracking/types';
import type { IExecutionTreeNode } from './types';

interface IExecutionTreeContentProps {
  executionTree: IExecutionTreeNode[];
  selectedBlockId?: string;
  showDebug: boolean;
  showProgress: boolean;
  onToggleExpand: (blockId: string, isExpanded: boolean) => void;
  onBlockSelect: (block: IRealTimeBlockMessage) => void;
}

export function ExecutionTreeContent({
  executionTree,
  selectedBlockId,
  showDebug,
  showProgress,
  onToggleExpand,
  onBlockSelect,
}: IExecutionTreeContentProps) {
  return (
    <div className="flex-1 min-h-0">
      <ScrollArea className="h-full">
        {executionTree.length === 0 ? (
          <EmptyExecutionTree />
        ) : (
          <div className="space-y-2 pb-4">
            {executionTree.map((node) => (
              <ExecutionTreeNodeView
                key={node.block.blockMetadata.id}
                node={node}
                selectedBlockId={selectedBlockId}
                showDebug={showDebug}
                showProgress={showProgress}
                onToggleExpand={onToggleExpand}
                onBlockSelect={onBlockSelect}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
