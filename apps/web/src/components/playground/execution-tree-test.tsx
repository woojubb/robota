'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
    Play,
    RotateCcw,
    TestTube,
    Zap,
    GitBranch,
    Activity
} from 'lucide-react';
import { ExecutionTreeDebug } from './execution-tree-debug';
import { RealTimeToolBlock } from './real-time-tool-block';
import { PlaygroundBlockCollector } from '@/lib/playground/block-tracking/block-collector';
import { generateDemoExecutionData, generateComplexDemoData } from '@/lib/playground/demo-execution-data';
import type { RealTimeBlockMessage } from '@/lib/playground/block-tracking/types';

/**
 * 🧪 ExecutionTreeTest - Test Component for Real-Time Execution Tracking
 * 
 * This component provides a testing environment for the execution tree system.
 * It generates demo data and displays it using our new visualization components.
 */
export const ExecutionTreeTest: React.FC = () => {
    const [blockCollector] = useState(() => new PlaygroundBlockCollector());
    const [selectedBlock, setSelectedBlock] = useState<RealTimeBlockMessage | null>(null);
    const [lastUpdate, setLastUpdate] = useState(Date.now());

    // Generate demo data
    const handleGenerateDemo = () => {
        generateDemoExecutionData(blockCollector);
        setLastUpdate(Date.now());
    };

    const handleGenerateComplexDemo = () => {
        generateComplexDemoData(blockCollector);
        setLastUpdate(Date.now());
    };

    const handleClearData = () => {
        blockCollector.clearBlocks();
        setSelectedBlock(null);
        setLastUpdate(Date.now());
    };

    const handleBlockSelect = (block: RealTimeBlockMessage) => {
        setSelectedBlock(block);
    };

    const stats = blockCollector.getStats();

    return (
        <div className="h-screen p-4 bg-gray-50">
            <div className="h-full max-w-7xl mx-auto space-y-4">
                {/* Header */}
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-xl flex items-center space-x-2">
                                <TestTube className="w-6 h-6 text-blue-500" />
                                <span>Execution Tree Test Environment</span>
                                <Badge variant="outline" className="ml-2">
                                    Phase 3 Testing
                                </Badge>
                            </CardTitle>

                            <div className="flex items-center space-x-2">
                                <Button
                                    onClick={handleGenerateDemo}
                                    className="text-xs"
                                    size="sm"
                                >
                                    <Play className="w-3 h-3 mr-1" />
                                    Generate Demo
                                </Button>

                                <Button
                                    onClick={handleGenerateComplexDemo}
                                    variant="outline"
                                    className="text-xs"
                                    size="sm"
                                >
                                    <Zap className="w-3 h-3 mr-1" />
                                    Complex Demo
                                </Button>

                                <Button
                                    onClick={handleClearData}
                                    variant="outline"
                                    className="text-xs"
                                    size="sm"
                                >
                                    <RotateCcw className="w-3 h-3 mr-1" />
                                    Clear
                                </Button>
                            </div>
                        </div>
                    </CardHeader>

                    <CardContent className="pt-0">
                        <div className="flex items-center space-x-4 text-sm text-gray-600">
                            <div className="flex items-center space-x-1">
                                <Activity className="w-4 h-4" />
                                <span>Blocks: {stats.total}</span>
                            </div>
                            <div className="flex items-center space-x-1">
                                <GitBranch className="w-4 h-4" />
                                <span>Root Blocks: {stats.rootBlocks}</span>
                            </div>
                            <div className="text-xs text-gray-500">
                                Last Update: {new Date(lastUpdate).toLocaleTimeString()}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Main content area */}
                <div className="flex-1 grid grid-cols-1 xl:grid-cols-3 gap-4 min-h-0">
                    {/* Left panel - Tree Debug */}
                    <div className="xl:col-span-2">
                        <Card className="h-full">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-lg flex items-center space-x-2">
                                    <GitBranch className="w-5 h-5" />
                                    <span>Execution Tree Debug</span>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="flex-1 min-h-0">
                                <div className="h-96 xl:h-full">
                                    <ExecutionTreeDebug
                                        blockCollector={blockCollector}
                                        refreshInterval={0} // Manual refresh for testing
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Right panel - Selected Block Details */}
                    <div>
                        <Card className="h-full">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-lg flex items-center space-x-2">
                                    <Activity className="w-5 h-5" />
                                    <span>Block Details</span>
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {selectedBlock ? (
                                    <div className="space-y-4">
                                        <RealTimeToolBlock
                                            block={selectedBlock}
                                            onToggleExpand={() => { }}
                                            onClick={() => { }}
                                            isSelected={true}
                                            showDebug={true}
                                            showProgress={true}
                                            level={0}
                                        />

                                        <Separator />

                                        <div>
                                            <h4 className="text-sm font-medium mb-2">Raw Block Data</h4>
                                            <pre className="text-xs bg-gray-100 p-3 rounded overflow-auto max-h-64">
                                                {JSON.stringify(selectedBlock, null, 2)}
                                            </pre>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center py-8 text-gray-500">
                                        <Activity className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                                        <p>Select a block to view details</p>
                                        <p className="text-xs text-gray-400 mt-1">
                                            Click on any block in the tree debug view
                                        </p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>

                {/* Footer with instructions */}
                <Card>
                    <CardContent className="py-3">
                        <div className="text-sm text-gray-600 space-y-2">
                            <p><strong>Testing Instructions:</strong></p>
                            <ol className="list-decimal list-inside space-y-1 text-xs">
                                <li>Click "Generate Demo" to create sample hierarchical execution data</li>
                                <li>Check the "Hierarchical Tree" section to see the tree structure</li>
                                <li>Verify parent-child relationships are correctly established</li>
                                <li>Look at "Raw Blocks" to see individual block data</li>
                                <li>Observe execution timing, levels, and paths</li>
                                <li>Test the "Complex Demo" for more advanced scenarios</li>
                            </ol>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default ExecutionTreeTest; 