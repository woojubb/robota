'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
    GitBranch,
    Code,
    RotateCcw,
    Activity,
    Eye,
    RefreshCw,
    Play,
    Zap
} from 'lucide-react';
import type { PlaygroundBlockCollector } from '@/lib/playground/block-tracking/block-collector';
import type { RealTimeBlockMessage, RealTimeBlockMetadata } from '@/lib/playground/block-tracking/types';
import { generateDemoExecutionData, generateComplexDemoData } from '@/lib/playground/demo-execution-data';

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
export interface ExecutionTreeDebugProps {
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
export const ExecutionTreeDebug: React.FC<ExecutionTreeDebugProps> = ({
    blockCollector,
    refreshInterval = 1000
}) => {
    // Build hierarchical tree structure from flat block list
    const { debugTree, rawBlocks, stats } = useMemo(() => {
        const allBlocks = blockCollector.getBlocks();
        const realTimeBlocks = allBlocks.filter(block =>
            'startTime' in block.blockMetadata ||
            'executionHierarchy' in block.blockMetadata
        ) as RealTimeBlockMessage[];

        // Create a map for quick lookup
        const blockMap = new Map<string, RealTimeBlockMessage>();
        realTimeBlocks.forEach(block => {
            blockMap.set(block.blockMetadata.id, block);
        });

        // Build tree structure
        const rootNodes: DebugTreeNode[] = [];
        const nodeMap = new Map<string, DebugTreeNode>();

        // Convert blocks to debug nodes
        realTimeBlocks.forEach(block => {
            const metadata = block.blockMetadata as RealTimeBlockMetadata;
            const debugNode: DebugTreeNode = {
                id: metadata.id,
                type: metadata.type,
                state: metadata.visualState,
                toolName: metadata.executionContext?.toolName,
                level: metadata.executionHierarchy?.level ?? 0,
                parentId: metadata.parentId,
                startTime: metadata.startTime?.toISOString(),
                endTime: metadata.endTime?.toISOString(),
                duration: metadata.actualDuration,
                executionPath: metadata.executionHierarchy?.path,
                children: []
            };
            nodeMap.set(metadata.id, debugNode);
        });

        // Establish parent-child relationships
        realTimeBlocks.forEach(block => {
            const metadata = block.blockMetadata as RealTimeBlockMetadata;
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
    }, [blockCollector]);

    // Auto-refresh handler
    const [lastRefresh, setLastRefresh] = React.useState(Date.now());

    React.useEffect(() => {
        if (refreshInterval > 0) {
            const interval = setInterval(() => {
                setLastRefresh(Date.now());
            }, refreshInterval);

            return () => clearInterval(interval);
        }
    }, [refreshInterval]);

    // Manual refresh
    const handleRefresh = () => {
        setLastRefresh(Date.now());
    };

    // Clear all blocks
    const handleClear = () => {
        blockCollector.clearBlocks();
        setLastRefresh(Date.now());
    };

    // Generate demo data
    const handleGenerateDemo = () => {
        console.log('🎬 Generate Demo button clicked!');
        try {
            generateDemoExecutionData(blockCollector);
            setLastRefresh(Date.now());
            console.log('✅ Demo data generated successfully');
        } catch (error) {
            console.error('❌ Error generating demo data:', error);
        }
    };

    const handleGenerateComplexDemo = () => {
        console.log('🎬 Generate Complex Demo button clicked!');
        try {
            generateComplexDemoData(blockCollector);
            setLastRefresh(Date.now());
            console.log('✅ Complex demo data generated successfully');
        } catch (error) {
            console.error('❌ Error generating complex demo data:', error);
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
                        Last updated: {new Date(lastRefresh).toLocaleTimeString()}
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
                                        const metadata = block.blockMetadata as RealTimeBlockMetadata;
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
                                                        content: block.content?.substring(0, 100) + (block.content && block.content.length > 100 ? '...' : '')
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