'use client';

import React, { useMemo, useCallback } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
    GitBranch,
    Layers,
    Activity,
    ChevronDown,
    ChevronUp,
    RotateCcw,
    Filter,
    Search,
    Eye,
    EyeOff
} from 'lucide-react';
import { RealTimeToolBlock } from './real-time-tool-block';
import type {
    RealTimeBlockMessage,
    RealTimeBlockMetadata,
    PlaygroundBlockCollector
} from '@/lib/playground/block-tracking/types';

/**
 * Tree node structure for hierarchical rendering
 */
interface ExecutionTreeNode {
    block: RealTimeBlockMessage;
    children: ExecutionTreeNode[];
    level: number;
}

/**
 * Props for ExecutionTreeVisualizer component
 */
export interface ExecutionTreeVisualizerProps {
    /** Block collector containing all execution blocks */
    blockCollector: PlaygroundBlockCollector;

    /** Whether to show debug information */
    showDebug?: boolean;

    /** Whether to show progress indicators */
    showProgress?: boolean;

    /** Whether to auto-expand new blocks */
    autoExpand?: boolean;

    /** Callback when a block is selected */
    onBlockSelect?: (block: RealTimeBlockMessage) => void;

    /** Currently selected block ID */
    selectedBlockId?: string;

    /** Filter function for blocks */
    blockFilter?: (block: RealTimeBlockMessage) => boolean;
}

/**
 * 🌳 ExecutionTreeVisualizer - Hierarchical Real-Time Execution Display
 * 
 * Manages and displays the complete execution tree with real-time updates.
 * Features:
 * - Automatic hierarchical organization based on parent-child relationships
 * - Real-time updates as execution progresses
 * - Interactive expand/collapse of execution branches
 * - Visual indicators for execution status and timing
 * - Filter and search capabilities
 */
export const ExecutionTreeVisualizer: React.FC<ExecutionTreeVisualizerProps> = ({
    blockCollector,
    showDebug = false,
    showProgress = true,
    autoExpand = true,
    onBlockSelect,
    selectedBlockId,
    blockFilter
}) => {
    // Build hierarchical tree structure from flat block list
    const executionTree = useMemo(() => {
        const allBlocks = blockCollector.getBlocks();
        const realTimeBlocks = allBlocks.filter(block =>
            'startTime' in block.blockMetadata ||
            'executionHierarchy' in block.blockMetadata
        ) as RealTimeBlockMessage[];

        // Apply filter if provided
        const filteredBlocks = blockFilter ?
            realTimeBlocks.filter(blockFilter) :
            realTimeBlocks;

        // Create a map for quick lookup
        const blockMap = new Map<string, RealTimeBlockMessage>();
        filteredBlocks.forEach(block => {
            blockMap.set(block.blockMetadata.id, block);
        });

        // Build tree structure
        const rootNodes: ExecutionTreeNode[] = [];
        const nodeMap = new Map<string, ExecutionTreeNode>();

        // First pass: create all nodes
        filteredBlocks.forEach(block => {
            const node: ExecutionTreeNode = {
                block,
                children: [],
                level: block.blockMetadata.executionHierarchy?.level ?? 0
            };
            nodeMap.set(block.blockMetadata.id, node);
        });

        // Second pass: establish parent-child relationships
        filteredBlocks.forEach(block => {
            const node = nodeMap.get(block.blockMetadata.id);
            if (!node) return;

            const parentId = block.blockMetadata.parentId;
            if (parentId && nodeMap.has(parentId)) {
                const parentNode = nodeMap.get(parentId)!;
                parentNode.children.push(node);
                // Update level to be consistent with hierarchy
                node.level = parentNode.level + 1;
            } else {
                // No parent or parent not found - this is a root node
                rootNodes.push(node);
            }
        });

        // Sort nodes by timestamp for consistent ordering
        const sortNodesByTime = (nodes: ExecutionTreeNode[]) => {
            nodes.sort((a, b) => {
                const aTime = a.block.blockMetadata.startTime?.getTime() ?? 0;
                const bTime = b.block.blockMetadata.startTime?.getTime() ?? 0;
                return aTime - bTime;
            });

            // Recursively sort children
            nodes.forEach(node => {
                if (node.children.length > 0) {
                    sortNodesByTime(node.children);
                }
            });
        };

        sortNodesByTime(rootNodes);

        return rootNodes;
    }, [blockCollector, blockFilter]);

    // Calculate execution statistics
    const executionStats = useMemo(() => {
        const allBlocks = blockCollector.getBlocks();
        const realTimeBlocks = allBlocks.filter(block =>
            'startTime' in block.blockMetadata
        ) as RealTimeBlockMessage[];

        const stats = {
            total: realTimeBlocks.length,
            pending: 0,
            inProgress: 0,
            completed: 0,
            error: 0,
            totalDuration: 0,
            avgDuration: 0
        };

        let completedDurations: number[] = [];

        realTimeBlocks.forEach(block => {
            const metadata = block.blockMetadata as RealTimeBlockMetadata;
            switch (metadata.visualState) {
                case 'pending':
                    stats.pending++;
                    break;
                case 'in_progress':
                    stats.inProgress++;
                    break;
                case 'completed':
                    stats.completed++;
                    if (metadata.actualDuration) {
                        completedDurations.push(metadata.actualDuration);
                        stats.totalDuration += metadata.actualDuration;
                    }
                    break;
                case 'error':
                    stats.error++;
                    break;
            }
        });

        if (completedDurations.length > 0) {
            stats.avgDuration = stats.totalDuration / completedDurations.length;
        }

        return stats;
    }, [blockCollector]);

    // Handle block selection
    const handleBlockSelect = useCallback((block: RealTimeBlockMessage) => {
        onBlockSelect?.(block);
    }, [onBlockSelect]);

    // Handle block expand/collapse
    const handleToggleExpand = useCallback((blockId: string, isExpanded: boolean) => {
        // Update the block's expand state in the collector
        blockCollector.updateRealTimeBlock(blockId, { isExpanded });
    }, [blockCollector]);

    // Render a single tree node and its children
    const renderTreeNode = useCallback((node: ExecutionTreeNode): React.ReactNode => {
        const hasChildren = node.children.length > 0;

        return (
            <div key={node.block.blockMetadata.id} className="relative">
                <RealTimeToolBlock
                    block={node.block}
                    level={node.level}
                    isSelected={selectedBlockId === node.block.blockMetadata.id}
                    showDebug={showDebug}
                    showProgress={showProgress}
                    onToggleExpand={handleToggleExpand}
                    onClick={handleBlockSelect}
                >
                    {/* Render children if expanded */}
                    {hasChildren && node.block.blockMetadata.isExpanded && (
                        <div className="space-y-1">
                            {node.children.map(childNode => renderTreeNode(childNode))}
                        </div>
                    )}
                </RealTimeToolBlock>
            </div>
        );
    }, [selectedBlockId, showDebug, showProgress, handleToggleExpand, handleBlockSelect]);

    // Clear all blocks
    const handleClearBlocks = useCallback(() => {
        blockCollector.clearBlocks();
    }, [blockCollector]);

    return (
        <div className="h-full flex flex-col space-y-4">
            {/* Header with statistics and controls */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-lg flex items-center space-x-2">
                            <GitBranch className="w-5 h-5" />
                            <span>Execution Tree</span>
                        </CardTitle>

                        <div className="flex items-center space-x-2">
                            {/* Execution statistics */}
                            <div className="flex items-center space-x-2 text-sm">
                                <Badge variant="outline" className="space-x-1">
                                    <Activity className="w-3 h-3" />
                                    <span>{executionStats.total}</span>
                                </Badge>

                                {executionStats.inProgress > 0 && (
                                    <Badge variant="default" className="bg-blue-500">
                                        {executionStats.inProgress} active
                                    </Badge>
                                )}

                                {executionStats.completed > 0 && (
                                    <Badge variant="default" className="bg-green-500">
                                        {executionStats.completed} done
                                    </Badge>
                                )}

                                {executionStats.error > 0 && (
                                    <Badge variant="destructive">
                                        {executionStats.error} failed
                                    </Badge>
                                )}
                            </div>

                            {/* Controls */}
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleClearBlocks}
                                className="text-xs"
                            >
                                <RotateCcw className="w-3 h-3 mr-1" />
                                Clear
                            </Button>
                        </div>
                    </div>
                </CardHeader>

                {/* Additional stats */}
                {executionStats.completed > 0 && (
                    <CardContent className="pt-0">
                        <div className="flex items-center space-x-4 text-xs text-gray-600">
                            <span>
                                Total Duration: {(executionStats.totalDuration / 1000).toFixed(1)}s
                            </span>
                            <span>
                                Avg Duration: {(executionStats.avgDuration / 1000).toFixed(1)}s
                            </span>
                        </div>
                    </CardContent>
                )}
            </Card>

            {/* Execution tree display */}
            <div className="flex-1 min-h-0">
                <ScrollArea className="h-full">
                    {executionTree.length === 0 ? (
                        <Card className="p-8">
                            <div className="text-center space-y-2">
                                <GitBranch className="w-12 h-12 mx-auto text-gray-400" />
                                <h3 className="text-lg font-medium text-gray-500">No Executions</h3>
                                <p className="text-sm text-gray-400">
                                    Real-time execution blocks will appear here as tools run
                                </p>
                            </div>
                        </Card>
                    ) : (
                        <div className="space-y-2 pb-4">
                            {executionTree.map(node => renderTreeNode(node))}
                        </div>
                    )}
                </ScrollArea>
            </div>
        </div>
    );
};

export default ExecutionTreeVisualizer; 