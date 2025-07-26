'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
    ChevronDown,
    ChevronRight,
    Play,
    Pause,
    CheckCircle,
    AlertCircle,
    Clock,
    Wrench,
    Bot,
    User,
    Layers,
    Timer,
    Activity,
    Code,
    ArrowRight,
    Zap
} from 'lucide-react';
import type { RealTimeBlockMessage, RealTimeBlockMetadata } from '@/lib/playground/block-tracking/types';

/**
 * Props for RealTimeToolBlock component
 */
export interface RealTimeToolBlockProps {
    /** The real-time block message to render */
    block: RealTimeBlockMessage;

    /** Child blocks for hierarchical rendering */
    children?: React.ReactNode;

    /** Callback when block expand/collapse state changes */
    onToggleExpand?: (blockId: string, isExpanded: boolean) => void;

    /** Callback when block is clicked */
    onClick?: (block: RealTimeBlockMessage) => void;

    /** Whether this block is currently selected */
    isSelected?: boolean;

    /** Current hierarchical level for indentation */
    level?: number;

    /** Whether to show detailed debug information */
    showDebug?: boolean;

    /** Whether to show real-time progress information */
    showProgress?: boolean;
}

/**
 * Get appropriate icon based on block type and execution context
 */
const getBlockTypeIcon = (metadata: RealTimeBlockMetadata) => {
    switch (metadata.type) {
        case 'user':
            return <User className="w-4 h-4 text-blue-600" />;
        case 'assistant':
            return <Bot className="w-4 h-4 text-green-600" />;
        case 'tool_call':
            return <Wrench className="w-4 h-4 text-purple-600" />;
        case 'tool_result':
            return <Code className="w-4 h-4 text-orange-600" />;
        case 'error':
            return <AlertCircle className="w-4 h-4 text-red-600" />;
        case 'group':
            return <Layers className="w-4 h-4 text-gray-600" />;
        default:
            return <Activity className="w-4 h-4 text-gray-500" />;
    }
};

/**
 * Get status icon based on execution state
 */
const getStatusIcon = (state: RealTimeBlockMetadata['visualState']) => {
    switch (state) {
        case 'pending':
            return <Clock className="w-3 h-3 text-gray-400" />;
        case 'in_progress':
            return <Play className="w-3 h-3 text-blue-500 animate-pulse" />;
        case 'completed':
            return <CheckCircle className="w-3 h-3 text-green-500" />;
        case 'error':
            return <AlertCircle className="w-3 h-3 text-red-500" />;
        default:
            return <Clock className="w-3 h-3 text-gray-400" />;
    }
};

/**
 * Get status color classes based on execution state
 */
const getStatusColors = (state: RealTimeBlockMetadata['visualState']) => {
    const baseColors = {
        pending: 'border-gray-200 bg-gray-50',
        in_progress: 'border-blue-200 bg-blue-50',
        completed: 'border-green-200 bg-green-50',
        error: 'border-red-200 bg-red-50'
    };

    const stateOverrides = {
        in_progress: 'ring-2 ring-blue-200 shadow-sm',
        error: 'ring-2 ring-red-200 shadow-sm',
        completed: 'shadow-sm'
    };

    return `${baseColors[state]} ${stateOverrides[state] || ''}`;
};

/**
 * Format duration in milliseconds to human-readable string
 */
const formatDuration = (duration?: number): string => {
    if (!duration) return '—';

    if (duration < 1000) {
        return `${duration.toFixed(0)}ms`;
    } else if (duration < 60000) {
        return `${(duration / 1000).toFixed(1)}s`;
    } else {
        const minutes = Math.floor(duration / 60000);
        const seconds = ((duration % 60000) / 1000).toFixed(0);
        return `${minutes}m ${seconds}s`;
    }
};

/**
 * Format timestamp to human-readable time
 */
const formatTime = (timestamp?: Date): string => {
    if (!timestamp) return '—';
    return timestamp.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 1
    });
};

/**
 * 🔗 RealTimeToolBlock - Enhanced Tool Execution Visualization
 * 
 * Displays real-time tool execution with hierarchical context and actual data.
 * Features:
 * - Real-time execution status and progress
 * - Hierarchical execution tree visualization
 * - Actual execution timing and duration
 * - Tool parameters and results display
 * - Interactive expand/collapse for details
 */
export const RealTimeToolBlock: React.FC<RealTimeToolBlockProps> = ({
    block,
    children,
    onToggleExpand,
    onClick,
    isSelected = false,
    level = 0,
    showDebug = false,
    showProgress = true
}) => {
    const [isExpanded, setIsExpanded] = useState(block.blockMetadata.isExpanded);

    const metadata = block.blockMetadata;
    const hasChildren = children || metadata.children.length > 0;

    // Calculate actual progress if tool provides it
    const actualProgress = useMemo(() => {
        if (metadata.toolProvidedData?.progress !== undefined) {
            return metadata.toolProvidedData.progress;
        }

        // Calculate based on execution state
        switch (metadata.visualState) {
            case 'pending':
                return 0;
            case 'in_progress':
                return metadata.actualDuration ? Math.min(95, 50) : 25; // Conservative estimate
            case 'completed':
                return 100;
            case 'error':
                return 0;
            default:
                return 0;
        }
    }, [metadata.visualState, metadata.toolProvidedData?.progress, metadata.actualDuration]);

    // Handle expand/collapse
    const handleToggleExpand = useCallback(() => {
        const newExpanded = !isExpanded;
        setIsExpanded(newExpanded);
        onToggleExpand?.(metadata.id, newExpanded);
    }, [isExpanded, metadata.id, onToggleExpand]);

    // Handle block click
    const handleClick = useCallback(() => {
        onClick?.(block);
    }, [block, onClick]);

    // Calculate indentation based on hierarchical level
    const indentationStyle = {
        marginLeft: `${level * 16}px`,
        borderLeft: level > 0 ? '2px solid #e5e7eb' : 'none',
        paddingLeft: level > 0 ? '12px' : '0'
    };

    return (
        <div style={indentationStyle} className="relative">
            {/* Hierarchical connection line */}
            {level > 0 && (
                <div className="absolute left-0 top-6 w-3 h-0 border-t-2 border-gray-300"></div>
            )}

            <Card
                className={`
                    ${getStatusColors(metadata.visualState)}
                    ${isSelected ? 'ring-2 ring-blue-400' : ''}
                    transition-all duration-200 hover:shadow-md cursor-pointer
                    mb-2
                `}
                onClick={handleClick}
            >
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            {/* Expand/Collapse button */}
                            {hasChildren && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleExpand();
                                    }}
                                >
                                    {isExpanded ?
                                        <ChevronDown className="w-4 h-4" /> :
                                        <ChevronRight className="w-4 h-4" />
                                    }
                                </Button>
                            )}

                            {/* Block type icon */}
                            {getBlockTypeIcon(metadata)}

                            {/* Title and execution context */}
                            <div className="flex flex-col">
                                <CardTitle className="text-sm font-medium">
                                    {metadata.executionContext?.toolName || block.role}
                                    {metadata.executionHierarchy && (
                                        <Badge variant="outline" className="ml-2 text-xs">
                                            Level {metadata.executionHierarchy.level}
                                        </Badge>
                                    )}
                                </CardTitle>

                                {/* Execution path */}
                                {metadata.executionHierarchy?.path && (
                                    <div className="flex items-center space-x-1 text-xs text-gray-500 mt-1">
                                        {metadata.executionHierarchy.path.map((step, index) => (
                                            <React.Fragment key={index}>
                                                {index > 0 && <ArrowRight className="w-3 h-3" />}
                                                <span>{step}</span>
                                            </React.Fragment>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Status and timing */}
                        <div className="flex items-center space-x-2">
                            {/* Real-time status */}
                            <div className="flex items-center space-x-1">
                                {getStatusIcon(metadata.visualState)}
                                <span className="text-xs capitalize text-gray-600">
                                    {metadata.visualState.replace('_', ' ')}
                                </span>
                            </div>

                            {/* Execution timing */}
                            {metadata.startTime && (
                                <Badge variant="secondary" className="text-xs">
                                    <Timer className="w-3 h-3 mr-1" />
                                    {metadata.actualDuration ?
                                        formatDuration(metadata.actualDuration) :
                                        formatTime(metadata.startTime)
                                    }
                                </Badge>
                            )}
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="pt-0">
                    {/* Main content */}
                    <div className="space-y-3">
                        {/* Block content */}
                        {block.content && (
                            <div className="text-sm text-gray-700 font-mono bg-gray-50 p-2 rounded border">
                                {block.content}
                            </div>
                        )}

                        {/* Real-time progress indicator */}
                        {showProgress && metadata.visualState === 'in_progress' && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-gray-600">Progress</span>
                                    <span className="font-medium">{actualProgress.toFixed(0)}%</span>
                                </div>
                                <Progress value={actualProgress} className="h-2" />

                                {/* Current step if provided by tool */}
                                {metadata.toolProvidedData?.currentStep && (
                                    <div className="flex items-center space-x-2 text-xs text-gray-600">
                                        <Activity className="w-3 h-3" />
                                        <span>{metadata.toolProvidedData.currentStep}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tool parameters (if any) */}
                        {metadata.toolParameters && (
                            <Collapsible>
                                <CollapsibleTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-auto p-0 text-xs text-gray-600">
                                        <Code className="w-3 h-3 mr-1" />
                                        Parameters
                                        <ChevronRight className="w-3 h-3 ml-1" />
                                    </Button>
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                    <pre className="text-xs bg-gray-100 p-2 rounded mt-1 overflow-x-auto">
                                        {JSON.stringify(metadata.toolParameters, null, 2)}
                                    </pre>
                                </CollapsibleContent>
                            </Collapsible>
                        )}

                        {/* Tool result (if completed) */}
                        {metadata.toolResult && metadata.visualState === 'completed' && (
                            <Collapsible>
                                <CollapsibleTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-auto p-0 text-xs text-green-600">
                                        <CheckCircle className="w-3 h-3 mr-1" />
                                        Result
                                        <ChevronRight className="w-3 h-3 ml-1" />
                                    </Button>
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                    <pre className="text-xs bg-green-50 p-2 rounded mt-1 overflow-x-auto border border-green-200">
                                        {typeof metadata.toolResult === 'string' ?
                                            metadata.toolResult :
                                            JSON.stringify(metadata.toolResult, null, 2)
                                        }
                                    </pre>
                                </CollapsibleContent>
                            </Collapsible>
                        )}

                        {/* Error information (if failed) */}
                        {metadata.renderData?.error && metadata.visualState === 'error' && (
                            <div className="bg-red-50 border border-red-200 p-2 rounded">
                                <div className="flex items-center space-x-2 text-red-700 text-xs font-medium">
                                    <AlertCircle className="w-3 h-3" />
                                    <span>Execution Error</span>
                                </div>
                                <pre className="text-xs text-red-600 mt-1 overflow-x-auto">
                                    {metadata.renderData.error.message || String(metadata.renderData.error)}
                                </pre>
                            </div>
                        )}

                        {/* Debug information */}
                        {showDebug && (
                            <Collapsible>
                                <CollapsibleTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-auto p-0 text-xs text-gray-500">
                                        <Zap className="w-3 h-3 mr-1" />
                                        Debug Info
                                        <ChevronRight className="w-3 h-3 ml-1" />
                                    </Button>
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                    <div className="text-xs bg-gray-50 p-2 rounded mt-1 space-y-1">
                                        <div><strong>Block ID:</strong> {metadata.id}</div>
                                        <div><strong>Execution ID:</strong> {metadata.executionContext?.executionId}</div>
                                        <div><strong>Parent ID:</strong> {metadata.parentId || 'None'}</div>
                                        <div><strong>Start Time:</strong> {formatTime(metadata.startTime)}</div>
                                        <div><strong>End Time:</strong> {formatTime(metadata.endTime)}</div>
                                        <div><strong>Duration:</strong> {formatDuration(metadata.actualDuration)}</div>
                                        {metadata.toolProvidedData && (
                                            <div><strong>Tool Data:</strong> {JSON.stringify(metadata.toolProvidedData)}</div>
                                        )}
                                    </div>
                                </CollapsibleContent>
                            </Collapsible>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Child blocks */}
            {isExpanded && children && (
                <div className="ml-4 border-l-2 border-gray-200 pl-4">
                    {children}
                </div>
            )}
        </div>
    );
};

export default RealTimeToolBlock; 