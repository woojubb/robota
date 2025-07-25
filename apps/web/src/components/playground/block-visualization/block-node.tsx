import React, { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, Play, Pause, AlertCircle, CheckCircle, Clock, Tool, User, Bot, Settings } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { BlockMessage, BlockMetadata } from '@/lib/playground/block-tracking';

/**
 * Props for BlockNode component
 */
export interface BlockNodeProps {
    /** The block message to render */
    block: BlockMessage;

    /** Child blocks to render */
    children?: React.ReactNode;

    /** Callback when block expand/collapse state changes */
    onToggleExpand?: (blockId: string, isExpanded: boolean) => void;

    /** Callback when block is clicked */
    onClick?: (block: BlockMessage) => void;

    /** Whether this block is currently selected */
    isSelected?: boolean;

    /** Current indentation level */
    level?: number;

    /** Whether to show debug information */
    showDebug?: boolean;
}

/**
 * Get icon based on block type
 */
const getBlockIcon = (type: BlockMetadata['type']) => {
    switch (type) {
        case 'user':
            return <User className="w-4 h-4" />;
        case 'assistant':
            return <Bot className="w-4 h-4" />;
        case 'tool_call':
            return <Tool className="w-4 h-4" />;
        case 'tool_result':
            return <Settings className="w-4 h-4" />;
        case 'error':
            return <AlertCircle className="w-4 h-4" />;
        case 'group':
            return <Settings className="w-4 h-4" />;
        default:
            return <Settings className="w-4 h-4" />;
    }
};

/**
 * Get visual state icon
 */
const getStateIcon = (state: BlockMetadata['visualState']) => {
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
 * Get color scheme based on block type and state
 */
const getBlockColors = (type: BlockMetadata['type'], state: BlockMetadata['visualState']) => {
    const baseColors = {
        user: 'bg-blue-50 border-blue-200 text-blue-900',
        assistant: 'bg-green-50 border-green-200 text-green-900',
        tool_call: 'bg-purple-50 border-purple-200 text-purple-900',
        tool_result: 'bg-orange-50 border-orange-200 text-orange-900',
        error: 'bg-red-50 border-red-200 text-red-900',
        group: 'bg-gray-50 border-gray-200 text-gray-900'
    };

    const stateOverrides = {
        in_progress: 'ring-2 ring-blue-300 animate-pulse',
        error: 'ring-2 ring-red-300',
        completed: 'ring-1 ring-green-200'
    };

    return `${baseColors[type]} ${stateOverrides[state] || ''}`;
};

/**
 * Format duration for display
 */
const formatDuration = (duration?: number) => {
    if (!duration) return '';
    if (duration < 1000) return `${duration}ms`;
    return `${(duration / 1000).toFixed(1)}s`;
};

/**
 * BlockNode Component
 * Renders a single block with hierarchical structure and visual states
 */
export const BlockNode: React.FC<BlockNodeProps> = ({
    block,
    children,
    onToggleExpand,
    onClick,
    isSelected = false,
    level = 0,
    showDebug = false
}) => {
    const { blockMetadata, content } = block;
    const [localExpanded, setLocalExpanded] = useState(blockMetadata.isExpanded);

    const hasChildren = blockMetadata.children.length > 0 || children;
    const indentLevel = Math.min(level, 8); // Limit deep nesting

    const handleToggleExpand = useCallback(() => {
        const newExpanded = !localExpanded;
        setLocalExpanded(newExpanded);
        onToggleExpand?.(blockMetadata.id, newExpanded);
    }, [localExpanded, blockMetadata.id, onToggleExpand]);

    const handleClick = useCallback(() => {
        onClick?.(block);
    }, [block, onClick]);

    const blockColors = getBlockColors(blockMetadata.type, blockMetadata.visualState);
    const stateIcon = getStateIcon(blockMetadata.visualState);
    const typeIcon = getBlockIcon(blockMetadata.type);

    return (
        <div
            className={`block-node`}
            style={{ marginLeft: `${indentLevel * 16}px` }}
        >
            <Collapsible open={localExpanded} onOpenChange={setLocalExpanded}>
                <Card
                    className={`
            ${blockColors}
            transition-all duration-200 ease-in-out
            hover:shadow-sm cursor-pointer
            ${isSelected ? 'ring-2 ring-blue-500' : ''}
            mb-1
          `}
                    onClick={handleClick}
                >
                    <CardContent className="p-3">
                        <div className="flex items-start gap-2">
                            {/* Expand/Collapse Button */}
                            {hasChildren && (
                                <CollapsibleTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0 hover:bg-black/5"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleToggleExpand();
                                        }}
                                    >
                                        {localExpanded ? (
                                            <ChevronDown className="w-3 h-3" />
                                        ) : (
                                            <ChevronRight className="w-3 h-3" />
                                        )}
                                    </Button>
                )}
                                </CollapsibleTrigger>

              {/* Block Icon */}
                            <div className="flex-shrink-0 mt-0.5">
                                {typeIcon}
                            </div>

                            {/* Block Content */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    {/* Block Type Badge */}
                                    <Badge variant="secondary" className="text-xs">
                                        {blockMetadata.type.replace('_', ' ')}
                                    </Badge>

                                    {/* State Icon */}
                                    {stateIcon}

                                    {/* Tool Name */}
                                    {blockMetadata.executionContext?.toolName && (
                                        <Badge variant="outline" className="text-xs">
                                            {blockMetadata.executionContext.toolName}
                                        </Badge>
                                    )}

                                    {/* Duration */}
                                    {blockMetadata.executionContext?.duration && (
                                        <span className="text-xs text-gray-500">
                                            {formatDuration(blockMetadata.executionContext.duration)}
                                        </span>
                                    )}
                                </div>

                                {/* Block Content */}
                                <div className="text-sm">
                                    {blockMetadata.type === 'tool_call' && blockMetadata.renderData?.parameters ? (
                                        <div>
                                            <div className="font-medium mb-1">{content}</div>
                                            <div className="text-xs text-gray-600 bg-black/5 rounded p-2 font-mono">
                                                {JSON.stringify(blockMetadata.renderData.parameters, null, 2)}
                                            </div>
                                        </div>
                                    ) : blockMetadata.type === 'tool_result' && blockMetadata.renderData?.result ? (
                                        <div>
                                            <div className="font-medium mb-1">Result:</div>
                                            <div className="text-xs text-gray-700 bg-black/5 rounded p-2 font-mono max-h-32 overflow-y-auto">
                                                {typeof blockMetadata.renderData.result === 'string'
                                                    ? blockMetadata.renderData.result
                                                    : JSON.stringify(blockMetadata.renderData.result, null, 2)
                                                }
                                            </div>
                                        </div>
                                    ) : blockMetadata.type === 'error' && blockMetadata.renderData?.error ? (
                                        <div>
                                            <div className="font-medium mb-1 text-red-700">Error:</div>
                                            <div className="text-xs text-red-600 bg-red-50 rounded p-2 font-mono">
                                                {blockMetadata.renderData.error instanceof Error
                                                    ? blockMetadata.renderData.error.message
                                                    : String(blockMetadata.renderData.error)
                                                }
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="whitespace-pre-wrap">{content}</div>
                                    )}
                                </div>

                                {/* Debug Information */}
                                {showDebug && (
                                    <div className="mt-2 text-xs text-gray-500 bg-gray-100 rounded p-2">
                                        <div>ID: {blockMetadata.id}</div>
                                        <div>Level: {blockMetadata.level}</div>
                                        <div>Children: {blockMetadata.children.length}</div>
                                        {blockMetadata.executionContext?.executionId && (
                                            <div>Execution ID: {blockMetadata.executionContext.executionId}</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Children */}
                {hasChildren && (
                    <CollapsibleContent className="space-y-1">
                        {children}
                    </CollapsibleContent>
                )}
            </Collapsible>
        </div>
    );
}; 