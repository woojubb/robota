'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import {
    GitBranch,
    Code,
    RotateCcw,
    RefreshCw,
    Play,
    Zap
} from 'lucide-react';
import type { PlaygroundBlockCollector } from '../../lib/playground/block-tracking/block-collector';
import type { IRealTimeBlockMessage, IRealTimeBlockMetadata } from '../../lib/playground/block-tracking/types';
import { generateDemoExecutionData, generateComplexDemoData } from '../../lib/playground/demo-execution-data';
import { WebLogger } from '../../lib/web-logger';

/**
 * Tree node structure for debugging
 */
interface DebugTreeNode {
    id: string;
    type: string;
    state: string;
    toolName?: string;
    level: number;
    parentId?: string;
    startTime?: string;
    endTime?: string;
    duration?: number;
    executionPath?: string[];
    children: DebugTreeNode[];
}

/**
 * Props for ExecutionTreeDebug component
 */
export interface IExecutionTreeDebugProps {
    /** Block collector containing all execution blocks */
    blockCollector: PlaygroundBlockCollector;

    /** Auto-refresh interval in milliseconds */
    refreshInterval?: number;
}

/**
 * 🔍 ExecutionTreeDebug - JSON Tree Structure Visualizer
 * 
 * Shows the raw tree structure as JSON to verify the tree building logic.
 * This helps debug the hierarchical execution tracking before implementing complex UI.
 */
export const ExecutionTreeDebug: React.FC<IExecutionTreeDebugProps> = ({
    blockCollector,
    refreshInterval = 1000
}) => {
    // Auto-refresh handler (moved up for dependency order)
    const [lastRefresh, setLastRefresh] = React.useState(Date.now());
    const [isClient, setIsClient] = React.useState(false);

    // Build hierarchical tree structure from flat block list
    const { debugTree, rawBlocks, stats } = useMemo(() => {
        const allBlocks = blockCollector.getBlocks();
        const realTimeBlocks = allBlocks.filter(block =>
            'startTime' in block.blockMetadata ||
            'executionHierarchy' in block.blockMetadata
        ) as IRealTimeBlockMessage[];

        // Create a map for quick lookup
        const blockMap = new Map<string, IRealTimeBlockMessage>();
        realTimeBlocks.forEach(block => {
            blockMap.set(block.blockMetadata.id, block);
        });

        // Build tree structure
        const rootNodes: DebugTreeNode[] = [];
        const nodeMap = new Map<string, DebugTreeNode>();

        // Convert blocks to debug nodes
        realTimeBlocks.forEach(block => {
            const metadata = block.blockMetadata as IRealTimeBlockMetadata;
            const debugNode: DebugTreeNode = {
                id: metadata.id,
                type: metadata.type,
                state: metadata.visualState,
                toolName: metadata.executionContext?.toolName,
                level: metadata.executionHierarchy?.level ?? 0,
                parentId: metadata.parentId,
                startTime: isClient && metadata.startTime ? metadata.startTime.toISOString() : undefined,
                endTime: isClient && metadata.endTime ? metadata.endTime.toISOString() : undefined,
                duration: metadata.actualDuration,
                executionPath: metadata.executionHierarchy?.path,
                children: []
            };
            nodeMap.set(metadata.id, debugNode);
        });

        // Establish parent-child relationships
        realTimeBlocks.forEach(block => {
            const metadata = block.blockMetadata as IRealTimeBlockMetadata;
            const node = nodeMap.get(metadata.id);
            if (!node) return;

            const parentId = metadata.parentId;
            if (parentId && nodeMap.has(parentId)) {
                const parentNode = nodeMap.get(parentId)!;
                parentNode.children.push(node);
            } else {
                // No parent - this is a root node
                rootNodes.push(node);
            }
        });

        // Sort nodes by timestamp for consistent ordering
        const sortNodesByTime = (nodes: DebugTreeNode[]) => {
            nodes.sort((a, b) => {
                const aTime = a.startTime ? new Date(a.startTime).getTime() : 0;
                const bTime = b.startTime ? new Date(b.startTime).getTime() : 0;
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

        // Calculate stats
        const stats = {
            totalBlocks: realTimeBlocks.length,
            rootNodes: rootNodes.length,
            pending: realTimeBlocks.filter(b => b.blockMetadata.visualState === 'pending').length,
            inProgress: realTimeBlocks.filter(b => b.blockMetadata.visualState === 'in_progress').length,
            completed: realTimeBlocks.filter(b => b.blockMetadata.visualState === 'completed').length,
            error: realTimeBlocks.filter(b => b.blockMetadata.visualState === 'error').length,
        };

        return {
            debugTree: rootNodes,
            rawBlocks: realTimeBlocks,
            stats
        };
    }, [blockCollector, lastRefresh]);



    React.useEffect(() => {
        // Set client flag to prevent hydration mismatch
        setIsClient(true);

        if (refreshInterval > 0) {
            const interval = setInterval(() => {
                setLastRefresh(Date.now());
            }, refreshInterval);

            return () => clearInterval(interval);
        }
        return;
    }, [refreshInterval]);

    // Manual refresh
    const handleRefresh = () => {
        setLastRefresh(Date.now());
    };

    // Clear all blocks
    const handleClear = () => {
        WebLogger.debug('Clear button clicked');
        WebLogger.debug('Blocks before clear', { count: blockCollector.getBlocks().length });
        blockCollector.clearBlocks();
        WebLogger.debug('Blocks after clear', { count: blockCollector.getBlocks().length });
        setLastRefresh(Date.now());
        WebLogger.info('Clear completed');
    };

    // Generate demo data
    const handleGenerateDemo = () => {
        WebLogger.debug('Generate Demo button clicked');
        WebLogger.debug('Current block count before', { count: blockCollector.getBlocks().length });

        try {
            // First test with a simple manual block
            const testBlock: IRealTimeBlockMessage = {
                role: 'user',
                content: 'Test message from debug',
                timestamp: new Date(),
                blockMetadata: {
                    id: 'test_' + Date.now(),
                    type: 'user',
                    level: 0,
                    parentId: undefined,
                    children: [],
                    isExpanded: true,
                    visualState: 'completed',
                    startTime: new Date(),
                    endTime: new Date(),
                    actualDuration: 100,
                    executionContext: {
                        timestamp: new Date()
                    }
                }
            };

            WebLogger.debug('Adding test block', { testBlock });
            blockCollector.collectBlock(testBlock);
            WebLogger.debug('Block count after test block', { count: blockCollector.getBlocks().length });

            // Then generate demo data
            generateDemoExecutionData(blockCollector);
            WebLogger.debug('Current block count after demo', { count: blockCollector.getBlocks().length });
            setLastRefresh(Date.now());
            WebLogger.info('Demo data generated successfully');
        } catch (error) {
            WebLogger.error('Error generating demo data', { error: error instanceof Error ? error.message : String(error) });
        }
    };

    const handleGenerateComplexDemo = () => {
        WebLogger.debug('Generate Complex Demo button clicked');
        try {
            generateComplexDemoData(blockCollector);
            setLastRefresh(Date.now());
            WebLogger.info('Complex demo data generated successfully');
        } catch (error) {
            WebLogger.error('Error generating complex demo data', { error: error instanceof Error ? error.message : String(error) });
        }
    };

    return (
        <div className="h-full flex flex-col space-y-4">
            {/* Header with controls */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-lg flex items-center space-x-2">
                            <GitBranch className="w-5 h-5" />
                            <span>Execution Tree Debug</span>
                        </CardTitle>

                        <div className="flex items-center space-x-2">
                            {/* Statistics */}
                            <div className="flex items-center space-x-2 text-sm">
                                <Badge variant="outline">
                                    {stats.totalBlocks} blocks
                                </Badge>
                                <Badge variant="outline">
                                    {stats.rootNodes} roots
                                </Badge>

                                {stats.inProgress > 0 && (
                                    <Badge className="bg-blue-500">
                                        {stats.inProgress} active
                                    </Badge>
                                )}

                                {stats.completed > 0 && (
                                    <Badge className="bg-green-500">
                                        {stats.completed} done
                                    </Badge>
                                )}

                                {stats.error > 0 && (
                                    <Badge variant="destructive">
                                        {stats.error} failed
                                    </Badge>
                                )}
                            </div>

                            {/* Demo Controls */}
                            <Button
                                onClick={handleGenerateDemo}
                                size="sm"
                                className="text-xs bg-blue-500 hover:bg-blue-600"
                            >
                                <Play className="w-3 h-3 mr-1" />
                                Generate Demo
                            </Button>

                            <Button
                                onClick={handleGenerateComplexDemo}
                                variant="outline"
                                size="sm"
                                className="text-xs"
                            >
                                <Zap className="w-3 h-3 mr-1" />
                                Complex Demo
                            </Button>

                            {/* Controls */}
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleRefresh}
                                className="text-xs"
                            >
                                <RefreshCw className="w-3 h-3 mr-1" />
                                Refresh
                            </Button>

                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleClear}
                                className="text-xs"
                            >
                                <RotateCcw className="w-3 h-3 mr-1" />
                                Clear
                            </Button>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="pt-0">
                    <div className="text-xs text-gray-600">
                        Last updated: {isClient ? new Date(lastRefresh).toLocaleTimeString() : '--:--:--'}
                        {refreshInterval > 0 && ` (auto-refresh every ${refreshInterval}ms)`}
                    </div>
                </CardContent>
            </Card>

            {/* Tree structure display */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Hierarchical Tree Structure */}
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center space-x-2">
                            <GitBranch className="w-4 h-4" />
                            <span>Hierarchical Tree</span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ScrollArea className="h-96">
                            {debugTree.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">
                                    <GitBranch className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                                    <p>No execution blocks yet</p>
                                    <p className="text-xs text-gray-400 mt-1">
                                        Run some tools to see the tree structure
                                    </p>
                                </div>
                            ) : (
                                <pre className="text-xs font-mono bg-gray-50 p-3 rounded border overflow-auto">
                                    {JSON.stringify(debugTree, null, 2)}
                                </pre>
                            )}
                        </ScrollArea>
                    </CardContent>
                </Card>

                {/* Raw Blocks Data */}
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center space-x-2">
                            <Code className="w-4 h-4" />
                            <span>Raw Blocks ({rawBlocks.length})</span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ScrollArea className="h-96">
                            {rawBlocks.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">
                                    <Code className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                                    <p>No blocks collected</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {rawBlocks.map((block, index) => {
                                        const metadata = block.blockMetadata as IRealTimeBlockMetadata;
                                        return (
                                            <div key={metadata.id} className="border rounded p-2 text-xs">
                                                <div className="flex items-center justify-between mb-2">
                                                    <Badge variant="outline" className="text-xs">
                                                        #{index + 1}
                                                    </Badge>
                                                    <Badge
                                                        variant={
                                                            metadata.visualState === 'completed' ? 'default' :
                                                                metadata.visualState === 'error' ? 'destructive' :
                                                                    metadata.visualState === 'in_progress' ? 'secondary' :
                                                                        'outline'
                                                        }
                                                        className="text-xs"
                                                    >
                                                        {metadata.visualState}
                                                    </Badge>
                                                </div>
                                                <pre className="bg-gray-50 p-2 rounded text-xs overflow-auto">
                                                    {JSON.stringify({
                                                        id: metadata.id,
                                                        type: metadata.type,
                                                        toolName: metadata.executionContext?.toolName,
                                                        parentId: metadata.parentId,
                                                        level: metadata.executionHierarchy?.level,
                                                        path: metadata.executionHierarchy?.path,
                                                        startTime: metadata.startTime?.toISOString(),
                                                        duration: metadata.actualDuration,
                                                        content: typeof block.content === 'string'
                                                            ? (block.content.substring(0, 100) + (block.content.length > 100 ? '...' : ''))
                                                            : block.content
                                                                ? JSON.stringify(block.content).substring(0, 100) + '...'
                                                                : ''
                                                    }, null, 2)}
                                                </pre>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </ScrollArea>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default ExecutionTreeDebug; 