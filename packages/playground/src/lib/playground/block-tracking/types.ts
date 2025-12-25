import type { IToolCall, IToolExecutionContext, TToolParameters, TToolResultData, TUniversalValue } from '@robota-sdk/agents';

/**
 * Block-specific metadata for visual representation
 */
export type TBlockType = 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'error' | 'group';

export type TBlockVisualState = 'pending' | 'in_progress' | 'completed' | 'error';

export interface IBlockExecutionContextInfo {
    toolName?: string;
    agentId?: string;
    teamId?: string;
    executionId?: string;
    timestamp: Date;
    duration?: number;
}

export interface IBlockRenderData {
    parameters?: TToolParameters;
    result?: TToolResultData;
    error?: Error;
    reasoning?: string;
    toolSchema?: Record<string, TUniversalValue>;
}

export interface IBlockMetadata {
    /** Unique identifier for this block */
    id: string;

    /** Type of block for visual styling */
    type: TBlockType;

    /** Hierarchical level for nesting */
    level: number;

    /** Parent block ID for hierarchical structure */
    parentId?: string;

    /** Children block IDs */
    children: string[];

    /** Expandable/collapsible state */
    isExpanded: boolean;

    /** Execution context information */
    executionContext?: IBlockExecutionContextInfo;

    /** Visual state for real-time updates */
    visualState: TBlockVisualState;

    /** Additional data for block-specific rendering */
    renderData?: IBlockRenderData;
}

/**
 * 🆕 Real-time enhanced block metadata with hierarchical execution tracking
 * Includes all IBlockMetadata fields plus actual execution data (no simulation)
 */
export interface IToolExecutionStepInfo {
    id: string;
    name: string;
    estimatedDuration: number;
    description?: string;
}

export interface IToolProvidedProgressData {
    estimatedDuration?: number;
    executionSteps?: IToolExecutionStepInfo[];
    currentStep?: string;
    progress?: number;
}

export interface IExecutionHierarchyInfo {
    parentExecutionId?: string;
    rootExecutionId?: string;
    level: number;
    path: string[];
}

export interface IRealTimeBlockMetadata {
    // All standard IBlockMetadata fields

    /** Unique identifier for this block */
    id: string;

    /** Type of block for visual styling */
    type: TBlockType;

    /** Hierarchical level for nesting */
    level: number;

    /** Parent block ID for hierarchical structure */
    parentId?: string;

    /** Children block IDs */
    children: string[];

    /** Expandable/collapsible state */
    isExpanded: boolean;

    /** Execution context information */
    executionContext?: IBlockExecutionContextInfo;

    /** Visual state for real-time updates */
    visualState: TBlockVisualState;

    /** Additional data for block-specific rendering */
    renderData?: IBlockRenderData;

    // 🎯 Real execution timing data

    /** Actual execution start time */
    startTime?: Date;

    /** Actual execution completion time */
    endTime?: Date;

    /** Actual execution duration in milliseconds (calculated from actual times) */
    actualDuration?: number;

    // 🎯 Real execution data

    /** Actual tool parameters passed to execution */
    toolParameters?: TToolParameters;

    /** Actual tool execution result */
    toolResult?: TToolResultData;

    // 🌳 Hierarchical execution context

    /** Execution hierarchy information for tree visualization */
    executionHierarchy?: IExecutionHierarchyInfo;

    // 🔧 Tool-provided data (optional)

    /** Tool-provided progress/status information (if ProgressReportingTool) */
    toolProvidedData?: IToolProvidedProgressData;
}

/**
 * Enhanced message with block-specific metadata
 */
export interface IBlockMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    toolCalls?: IToolCall[];
    metadata?: Record<string, TUniversalValue>;
    timestamp?: Date;
    blockMetadata: IBlockMetadata;
}

/**
 * Enhanced message with real-time block metadata
 */
export interface IRealTimeBlockMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    toolCalls?: IToolCall[];
    metadata?: Record<string, TUniversalValue>;
    timestamp?: Date;
    blockMetadata: IRealTimeBlockMetadata;
}

/**
 * Block data collector interface for capturing tool executions
 */
export interface IBlockDataCollector {
    /** Collect a new block message */
    collectBlock(message: IBlockMessage): void;

    /** Update an existing block */
    updateBlock(blockId: string, updates: Partial<IBlockMetadata>): void;

    /** Get all collected blocks */
    getBlocks(): IBlockMessage[];

    /** Get blocks by parent ID for hierarchical rendering */
    getBlocksByParent(parentId?: string): IBlockMessage[];

    /** Clear all blocks */
    clearBlocks(): void;

    /** Generate unique block ID */
    generateBlockId(): string;

    /** Create a group block that can contain other blocks */
    createGroupBlock(
        type: 'user' | 'assistant' | 'tool_call' | 'group',
        content: string,
        parentId?: string,
        level?: number
    ): IBlockMessage;

    /** Get statistics about collected blocks */
    getStats(): {
        total: number;
        byType: Record<string, number>;
        byState: Record<string, number>;
        rootBlocks: number;
    };

    /** Add event listener */
    addListener(listener: TBlockCollectionListener): void;

    /** Remove event listener */
    removeListener(listener: TBlockCollectionListener): void;
}

/**
 * Tool execution tracking data
 */
export interface IToolExecutionTrackingData {
    toolName: string;
    parameters: TToolParameters;
    context?: IToolExecutionContext;
    startTime: Date;
    endTime?: Date;
    result?: TToolResultData;
    error?: Error;
    executionId: string;
    parentBlockId?: string;
}

/**
 * Agent delegation tracking data for team scenarios
 */
export interface IDelegationTrackingData {
    parentAgentId: string;
    delegatedAgentId: string;
    taskDescription: string;
    agentTemplate?: string;
    startTime: Date;
    endTime?: Date;
    result?: TUniversalValue;
    error?: Error;
    executionId: string;
    parentBlockId: string;
}

/**
 * Block tree structure for hierarchical visualization
 */
export interface IBlockTreeNode {
    block: IBlockMessage;
    children: IBlockTreeNode[];
    parent?: IBlockTreeNode;
}

/**
 * Block collection events for real-time updates
 */
export type TBlockCollectionEvent =
    | { type: 'block_added'; block: IBlockMessage }
    | { type: 'block_updated'; blockId: string; updates: Partial<IBlockMetadata> }
    | { type: 'block_removed'; blockId: string }
    | { type: 'blocks_cleared' };

/**
 * Block collection listener
 */
export type TBlockCollectionListener = (event: TBlockCollectionEvent) => void; 