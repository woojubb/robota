import React, { useEffect, useState, useCallback } from 'react';
import { BlockTree } from './block-tree';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    BarChart3,
    Activity,
    Zap,
    AlertTriangle,
    Clock,
    Users,
    Settings,
    GitBranch,
    Code
} from 'lucide-react';
import type {
    BlockMessage,
    BlockDataCollector
} from '@/lib/playground/block-tracking';
import { ExecutionTreeDebug } from '../execution-tree-debug';
import type { PlaygroundBlockCollector } from '@/lib/playground/block-tracking/block-collector';

/**
 * Props for BlockVisualizationPanel
 */
export interface BlockVisualizationPanelProps {
    /** Block collector instance */
    blockCollector: BlockDataCollector;

    /** Panel height */
    height?: string | number;

    /** Whether to show debug information */
    showDebug?: boolean;

    /** Whether to auto-scroll to new blocks */
    autoScroll?: boolean;

    /** Callback when a block is selected for inspection */
    onBlockInspect?: (block: BlockMessage) => void;
}

/**
 * Block Statistics Component
 */
const BlockStats: React.FC<{ blockCollector: BlockDataCollector }> = ({ blockCollector }) => {
    const [stats, setStats] = useState(blockCollector.getStats());

    useEffect(() => {
        const updateStats = () => {
            setStats(blockCollector.getStats());
        };

        blockCollector.addListener(updateStats);
        updateStats();

        return () => {
            blockCollector.removeListener(updateStats);
        };
    }, [blockCollector]);

    const { total, byType, byState, rootBlocks } = stats;

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center space-x-2">
                        <BarChart3 className="w-4 h-4 text-blue-500" />
                        <div>
                            <div className="text-2xl font-bold">{total}</div>
                            <div className="text-xs text-gray-500">Total Blocks</div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center space-x-2">
                        <Activity className="w-4 h-4 text-green-500" />
                        <div>
                            <div className="text-2xl font-bold">{byState.in_progress || 0}</div>
                            <div className="text-xs text-gray-500">Running</div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center space-x-2">
                        <Zap className="w-4 h-4 text-yellow-500" />
                        <div>
                            <div className="text-2xl font-bold">{byState.completed || 0}</div>
                            <div className="text-xs text-gray-500">Completed</div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center space-x-2">
                        <AlertTriangle className="w-4 h-4 text-red-500" />
                        <div>
                            <div className="text-2xl font-bold">{byState.error || 0}</div>
                            <div className="text-xs text-gray-500">Errors</div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

/**
 * Block Type Breakdown Component
 */
const BlockTypeBreakdown: React.FC<{ blockCollector: BlockDataCollector }> = ({ blockCollector }) => {
    const [stats, setStats] = useState(blockCollector.getStats());

    useEffect(() => {
        const updateStats = () => {
            setStats(blockCollector.getStats());
        };

        blockCollector.addListener(updateStats);
        updateStats();

        return () => {
            blockCollector.removeListener(updateStats);
        };
    }, [blockCollector]);

    const typeIcons = {
        user: <Users className="w-4 h-4" />,
        assistant: <Activity className="w-4 h-4" />,
        tool_call: <Settings className="w-4 h-4" />,
        tool_result: <Zap className="w-4 h-4" />,
        error: <AlertTriangle className="w-4 h-4" />,
        group: <BarChart3 className="w-4 h-4" />
    };

    return (
        <div className="space-y-3 p-4">
            {Object.entries(stats.byType).map(([type, count]) => (
                <div key={type} className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                        {typeIcons[type as keyof typeof typeIcons]}
                        <span className="text-sm font-medium capitalize">
                            {type.replace('_', ' ')}
                        </span>
                    </div>
                    <Badge variant="secondary">{count}</Badge>
                </div>
            ))}
        </div>
    );
};

/**
 * Block Inspection Panel
 */
const BlockInspectionPanel: React.FC<{
    selectedBlock: BlockMessage | null;
    onClose: () => void;
}> = ({ selectedBlock, onClose }) => {
    if (!selectedBlock) {
        return (
            <div className="p-4 text-center text-gray-500">
                <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <div className="text-sm">Select a block to inspect</div>
            </div>
        );
    }

    const { blockMetadata, content, role } = selectedBlock;

    return (
        <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="font-medium">Block Inspector</h3>
                <Button variant="ghost" size="sm" onClick={onClose}>
                    ×
                </Button>
            </div>

            <div className="space-y-3">
                <div>
                    <label className="text-xs font-medium text-gray-500">ID</label>
                    <div className="text-sm font-mono bg-gray-100 p-2 rounded">
                        {blockMetadata.id}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs font-medium text-gray-500">Type</label>
                        <div className="text-sm">{blockMetadata.type}</div>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-gray-500">State</label>
                        <div className="text-sm">{blockMetadata.visualState}</div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs font-medium text-gray-500">Level</label>
                        <div className="text-sm">{blockMetadata.level}</div>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-gray-500">Children</label>
                        <div className="text-sm">{blockMetadata.children.length}</div>
                    </div>
                </div>

                {blockMetadata.executionContext?.toolName && (
                    <div>
                        <label className="text-xs font-medium text-gray-500">Tool</label>
                        <div className="text-sm">{blockMetadata.executionContext.toolName}</div>
                    </div>
                )}

                {blockMetadata.executionContext?.duration && (
                    <div>
                        <label className="text-xs font-medium text-gray-500">Duration</label>
                        <div className="text-sm">
                            {blockMetadata.executionContext.duration < 1000
                                ? `${blockMetadata.executionContext.duration}ms`
                                : `${(blockMetadata.executionContext.duration / 1000).toFixed(1)}s`
                            }
                        </div>
                    </div>
                )}

                <div>
                    <label className="text-xs font-medium text-gray-500">Content</label>
                    <div className="text-sm bg-gray-100 p-2 rounded max-h-32 overflow-y-auto">
                        {content}
                    </div>
                </div>

                {blockMetadata.renderData && (
                    <div>
                        <label className="text-xs font-medium text-gray-500">Render Data</label>
                        <div className="text-xs bg-gray-100 p-2 rounded max-h-40 overflow-y-auto font-mono">
                            {JSON.stringify(blockMetadata.renderData, null, 2)}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

/**
 * Main Block Visualization Panel Component
 * Provides complete block coding visualization with statistics and inspection
 */
export const BlockVisualizationPanel: React.FC<BlockVisualizationPanelProps> = ({
    blockCollector,
    height = '600px',
    showDebug = false,
    autoScroll = true,
    onBlockInspect
}) => {
    const [selectedBlock, setSelectedBlock] = useState<BlockMessage | null>(null);
    const [activeTab, setActiveTab] = useState<string>('tree');

    const handleBlockSelect = useCallback((block: BlockMessage) => {
        setSelectedBlock(block);
        onBlockInspect?.(block);

        // Auto-switch to inspection tab if not on tree
        if (activeTab !== 'tree') {
            setActiveTab('inspect');
        }
    }, [onBlockInspect, activeTab]);

    const handleCloseInspection = useCallback(() => {
        setSelectedBlock(null);
    }, []);

    return (
        <Card className="flex flex-col h-full">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-blue-500" />
                    Block Visualization
                    <Badge variant="outline" className="ml-auto">
                        Real-time
                    </Badge>
                </CardTitle>
            </CardHeader>

            <CardContent className="flex-1 p-0">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
                    <TabsList className="grid w-full grid-cols-5 mx-3 mb-0">
                        <TabsTrigger value="tree">Tree</TabsTrigger>
                        <TabsTrigger value="stats">Stats</TabsTrigger>
                        <TabsTrigger value="types">Types</TabsTrigger>
                        <TabsTrigger value="debug">Debug</TabsTrigger>
                        <TabsTrigger value="inspect">Inspect</TabsTrigger>
                    </TabsList>

                    <div className="flex-1" style={{ height }}>
                        <TabsContent value="tree" className="h-full m-0">
                            <BlockTree
                                blockCollector={blockCollector}
                                height="100%"
                                showDebug={showDebug}
                                autoScroll={autoScroll}
                                onBlockSelect={handleBlockSelect}
                                selectedBlockId={selectedBlock?.blockMetadata.id}
                                showControls={true}
                            />
                        </TabsContent>

                        <TabsContent value="stats" className="h-full m-0">
                            <div className="h-full overflow-y-auto">
                                <BlockStats blockCollector={blockCollector} />
                            </div>
                        </TabsContent>

                        <TabsContent value="types" className="h-full m-0">
                            <div className="h-full overflow-y-auto">
                                <BlockTypeBreakdown blockCollector={blockCollector} />
                            </div>
                        </TabsContent>

                        <TabsContent value="debug" className="h-full m-0">
                            <div className="h-full overflow-y-auto p-3">
                                <ExecutionTreeDebug
                                    blockCollector={blockCollector as PlaygroundBlockCollector}
                                    refreshInterval={1000}
                                />
                            </div>
                        </TabsContent>

                        <TabsContent value="inspect" className="h-full m-0">
                            <div className="h-full overflow-y-auto">
                                <BlockInspectionPanel
                                    selectedBlock={selectedBlock}
                                    onClose={handleCloseInspection}
                                />
                            </div>
                        </TabsContent>
                    </div>
                </Tabs>
            </CardContent>
        </Card>
    );
}; 