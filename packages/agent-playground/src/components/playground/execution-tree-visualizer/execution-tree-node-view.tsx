import { RealTimeToolBlock } from '../real-time-tool-block';
import type { IRealTimeBlockMessage } from '../../../lib/playground/block-tracking/types';
import type { IExecutionTreeNode } from './types';

interface IExecutionTreeNodeViewProps {
  node: IExecutionTreeNode;
  selectedBlockId?: string;
  showDebug: boolean;
  showProgress: boolean;
  onToggleExpand: (blockId: string, isExpanded: boolean) => void;
  onBlockSelect: (block: IRealTimeBlockMessage) => void;
}

export function ExecutionTreeNodeView({
  node,
  selectedBlockId,
  showDebug,
  showProgress,
  onToggleExpand,
  onBlockSelect,
}: IExecutionTreeNodeViewProps) {
  const hasChildren = node.children.length > 0;

  return (
    <div className="relative">
      <RealTimeToolBlock
        block={node.block}
        level={node.level}
        isSelected={selectedBlockId === node.block.blockMetadata.id}
        showDebug={showDebug}
        showProgress={showProgress}
        onToggleExpand={onToggleExpand}
        onClick={onBlockSelect}
      >
        {hasChildren && node.block.blockMetadata.isExpanded && (
          <div className="space-y-1">
            {node.children.map((childNode) => (
              <ExecutionTreeNodeView
                key={childNode.block.blockMetadata.id}
                node={childNode}
                selectedBlockId={selectedBlockId}
                showDebug={showDebug}
                showProgress={showProgress}
                onToggleExpand={onToggleExpand}
                onBlockSelect={onBlockSelect}
              />
            ))}
          </div>
        )}
      </RealTimeToolBlock>
    </div>
  );
}
