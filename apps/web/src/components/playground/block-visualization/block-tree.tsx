import React, { useCallback, useEffect, useState } from 'react';
import { BlockNode } from './block-node';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, RefreshCw, Eye, EyeOff, MoreVertical } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type {
    BlockMessage,
    BlockDataCollector,
    BlockCollectionEvent,
    BlockTreeNode
} from '@/lib/playground/block-tracking';

/**
 * Props for BlockTree component
 */
export interface BlockTreeProps {
    /** Block collector to get data from */
    blockCollector: BlockDataCollector;

    /** Height of the tree container */
    height?: string | number;

    /** Whether to show debug information */
    showDebug?: boolean;

    /** Whether to auto-scroll to new blocks */
    autoScroll?: boolean;

    /** Callback when a block is selected */
    onBlockSelect?: (block: BlockMessage) => void;

    /** Currently selected block ID */
    selectedBlockId?: string;

    /** Whether to show tree controls */
    showControls?: boolean;
}

/**
 * BlockTree Component
 * Renders hierarchical block structure with real-time updates
 */
export const BlockTree: React.FC<BlockTreeProps> = ({
    blockCollector,
    height = '400px',
    showDebug = false,
    autoScroll = true,
    onBlockSelect,
    selectedBlockId,
    showControls = true
}) => {
    const [blocks, setBlocks] = useState<BlockMessage[]>([]);
    const [stats, setStats] = useState(() =>
        blockCollector ? blockCollector.getStats() : { total: 0, byType: {}, byState: {}, rootBlocks: 0 }
    );
    const [localShowDebug, setLocalShowDebug] = useState(showDebug);
    const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());

    // Update blocks when collector changes
    const updateBlocks = useCallback(() => {
        if (!blockCollector) return;

        const newBlocks = blockCollector.getBlocks();
        setBlocks(newBlocks);
        setStats(blockCollector.getStats());
    }, [blockCollector]);

    // Listen to block collection events
    useEffect(() => {
        if (!blockCollector) return;

        const handleBlockEvent = (event: BlockCollectionEvent) => {
            switch (event.type) {
                case 'block_added':
                    // Auto-expand parent blocks when new children are added
                    if (event.block.blockMetadata.parentId) {
                        setExpandedBlocks(prev => new Set([...prev, event.block.blockMetadata.parentId!]));
                    }
                    break;
                case 'block_updated':
                    // Could trigger specific animations here
                    break;
                case 'blocks_cleared':
                    setExpandedBlocks(new Set());
                    break;
            }
            updateBlocks();
        };

        // Add listener
        blockCollector.addListener(handleBlockEvent);

        // Initial load
        updateBlocks();

        // Cleanup
        return () => {
            blockCollector.removeListener(handleBlockEvent);
        };
    }, [blockCollector, updateBlocks]);

    // Build hierarchical tree structure
    const buildTree = useCallback((blocks: BlockMessage[]): BlockTreeNode[] => {
        const blockMap = new Map<string, BlockMessage>();
        const rootBlocks: BlockMessage[] = [];

        // Create block map
        blocks.forEach(block => {
            blockMap.set(block.blockMetadata.id, block);
        });

        // Identify root blocks and build tree
        blocks.forEach(block => {
            if (!block.blockMetadata.parentId) {
                rootBlocks.push(block);
            }
        });

        // Build tree nodes recursively
        const buildNode = (block: BlockMessage): BlockTreeNode => {
            const children = block.blockMetadata.children
                .map(childId => blockMap.get(childId))
                .filter((child): child is BlockMessage => child !== undefined)
                .map(child => buildNode(child));

            return {
                block,
                children,
                parent: undefined // Will be set by parent
            };
        };

        const treeNodes = rootBlocks.map(buildNode);

        // Set parent references
        const setParentReferences = (nodes: BlockTreeNode[], parent?: BlockTreeNode) => {
            nodes.forEach(node => {
                node.parent = parent;
                setParentReferences(node.children, node);
            });
        };
        setParentReferences(treeNodes);

        return treeNodes;
    }, []);

    // Handle block expand/collapse
    const handleToggleExpand = useCallback((blockId: string, isExpanded: boolean) => {
        setExpandedBlocks(prev => {
            const newSet = new Set(prev);
            if (isExpanded) {
                newSet.add(blockId);
            } else {
                newSet.delete(blockId);
            }
            return newSet;
        });

        // Update block collector
        if (blockCollector) {
            blockCollector.updateBlock(blockId, { isExpanded });
        }
    }, [blockCollector]);

    // Handle block selection
    const handleBlockClick = useCallback((block: BlockMessage) => {
        onBlockSelect?.(block);
    }, [onBlockSelect]);

    // Clear all blocks
    const handleClearBlocks = useCallback(() => {
        if (blockCollector) {
            blockCollector.clearBlocks();
        }
        setExpandedBlocks(new Set());
    }, [blockCollector]);

    // Refresh blocks
    const handleRefresh = useCallback(() => {
        updateBlocks();
    }, [updateBlocks]);

    // Expand all blocks
    const handleExpandAll = useCallback(() => {
        const allBlockIds = blocks.map(block => block.blockMetadata.id);
        setExpandedBlocks(new Set(allBlockIds));

        // Update block collector for all blocks
        if (blockCollector) {
            allBlockIds.forEach(blockId => {
                blockCollector.updateBlock(blockId, { isExpanded: true });
            });
        }
    }, [blocks, blockCollector]);

    // Collapse all blocks
    const handleCollapseAll = useCallback(() => {
        setExpandedBlocks(new Set());

        // Update block collector for all blocks
        if (blockCollector) {
            blocks.forEach(block => {
                blockCollector.updateBlock(block.blockMetadata.id, { isExpanded: false });
            });
        }
    }, [blocks, blockCollector]);

    // Render tree nodes recursively
    const renderTreeNode = useCallback((treeNode: BlockTreeNode, level: number = 0): React.ReactNode => {
        const { block, children } = treeNode;
        const isExpanded = expandedBlocks.has(block.blockMetadata.id) ?? block.blockMetadata.isExpanded;

        return (
            <BlockNode
                key={block.blockMetadata.id}
                block={block}
                level={level}
                isSelected={selectedBlockId === block.blockMetadata.id}
                showDebug={localShowDebug}
                onToggleExpand={handleToggleExpand}
                onClick={handleBlockClick}
            >
                {isExpanded && children.map(childNode => renderTreeNode(childNode, level + 1))}
            </BlockNode>
        );
    }, [expandedBlocks, selectedBlockId, localShowDebug, handleToggleExpand, handleBlockClick]);

    const treeNodes = buildTree(blocks);

    return (
        <div className="flex flex-col h-full">
            {/* Controls */}
            {showControls && (
                <div className="flex items-center justify-between p-3 border-b bg-gray-50">
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                            {stats.total} blocks
                        </Badge>
                        {stats.byState.in_progress > 0 && (
                            <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">
                                {stats.byState.in_progress} running
                            </Badge>
                        )}
                        {stats.byState.error > 0 && (
                            <Badge variant="destructive" className="text-xs">
                                {stats.byState.error} errors
                            </Badge>
                        )}
                    </div>

                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setLocalShowDebug(!localShowDebug)}
                            className="h-8"
                        >
                            {localShowDebug ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8">
                                    <MoreVertical className="w-4 h-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={handleRefresh}>
                                    <RefreshCw className="w-4 h-4 mr-2" />
                                    Refresh
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={handleExpandAll}>
                                    Expand All
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleCollapseAll}>
                                    Collapse All
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={handleClearBlocks} className="text-red-600">
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Clear All
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            )}

            {/* Tree Content */}
            <ScrollArea className="flex-1" style={{ height }}>
                <div className="p-2">
                    {treeNodes.length === 0 ? (
                        <div className="flex items-center justify-center h-32 text-gray-500">
                            <div className="text-center">
                                <div className="text-sm font-medium">No blocks yet</div>
                                <div className="text-xs">Blocks will appear here as tools execute</div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {treeNodes.map(treeNode => renderTreeNode(treeNode))}
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}; 