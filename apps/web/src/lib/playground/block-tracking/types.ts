import type { UniversalMessage, ToolExecutionContext } from '@robota-sdk/agents';

/**
 * Block-specific metadata for visual representation
 */
export interface BlockMetadata {
    /** Unique identifier for this block */
    id: string;

    /** Type of block for visual styling */
    type: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'error' | 'group';

    /** Hierarchical level for nesting */
    level: number;

    /** Parent block ID for hierarchical structure */
    parentId?: string;

    /** Children block IDs */
    children: string[];

    /** Expandable/collapsible state */
    isExpanded: boolean;

    /** Execution context information */
    executionContext?: {
        toolName?: string;
        agentId?: string;
        teamId?: string;
        executionId?: string;
        timestamp: Date;
        duration?: number;
    };

    /** Visual state for real-time updates */
    visualState: 'pending' | 'in_progress' | 'completed' | 'error';

    /** Additional data for block-specific rendering */
    renderData?: {
        parameters?: any;
        result?: any;
        error?: Error;
        reasoning?: string;
        toolSchema?: any;
    };
}

/**
 * 🆕 Real-time enhanced block metadata with hierarchical execution tracking
 * Includes all BlockMetadata fields plus actual execution data (no simulation)
 */
export interface RealTimeBlockMetadata {
    // 🔄 All standard BlockMetadata fields

    /** Unique identifier for this block */
    id: string;

    /** Type of block for visual styling */
    type: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'error' | 'group';

    /** Hierarchical level for nesting */
    level: number;

    /** Parent block ID for hierarchical structure */
    parentId?: string;

    /** Children block IDs */
    children: string[];

    /** Expandable/collapsible state */
    isExpanded: boolean;

    /** Execution context information */
    executionContext?: {
        toolName?: string;
        agentId?: string;
        teamId?: string;
        executionId?: string;
        timestamp: Date;
        duration?: number;
    };

    /** Visual state for real-time updates */
    visualState: 'pending' | 'in_progress' | 'completed' | 'error';

    /** Additional data for block-specific rendering */
    renderData?: {
        parameters?: any;
        result?: any;
        error?: Error;
        reasoning?: string;
        toolSchema?: any;
    };

    // 🎯 Real execution timing data

    /** Actual execution start time */
    startTime?: Date;

    /** Actual execution completion time */
    endTime?: Date;

    /** Actual execution duration in milliseconds (calculated from actual times) */
    actualDuration?: number;

    // 🎯 Real execution data

    /** Actual tool parameters passed to execution */
    toolParameters?: any;

    /** Actual tool execution result */
    toolResult?: any;

    // 🌳 Hierarchical execution context

    /** Execution hierarchy information for tree visualization */
    executionHierarchy?: {
        /** Parent execution ID for tracking hierarchical tool calls */
        parentExecutionId?: string;

        /** Root execution ID (Team/Agent level) */
        rootExecutionId?: string;

        /** Execution depth level (0: Team, 1: Agent, 2: Tool, etc.) */
        level: number;

        /** Execution path array showing complete hierarchy */
        path: string[];
    };

    // 🔧 Tool-provided data (optional)

    /** Tool-provided progress/status information (if ProgressReportingTool) */
    toolProvidedData?: {
        /** Tool's estimated duration (if provided) */
        estimatedDuration?: number;

        /** Tool's execution steps (if provided) */
        executionSteps?: Array<{
            id: string;
            name: string;
            estimatedDuration: number;
            description?: string;
        }>;

        /** Current step being executed */
        currentStep?: string;

        /** Progress percentage (0-100) if tool provides real-time updates */
        progress?: number;
    };
}

/**
 * Enhanced message with block-specific metadata
 */
export interface BlockMessage {
    // UniversalMessage fields
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    toolCalls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
    metadata?: Record<string, unknown>;
    timestamp?: Date;

    // Block-specific metadata
    blockMetadata: BlockMetadata;
}

/**
 * Enhanced message with real-time block metadata
 */
export interface RealTimeBlockMessage {
    // UniversalMessage fields
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    toolCalls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
    metadata?: Record<string, unknown>;
    timestamp?: Date;

    // Real-time block metadata
    blockMetadata: RealTimeBlockMetadata;
}

/**
 * Block data collector interface for capturing tool executions
 */
export interface BlockDataCollector {
    /** Collect a new block message */
    collectBlock(message: BlockMessage): void;

    /** Update an existing block */
    updateBlock(blockId: string, updates: Partial<BlockMetadata>): void;

    /** Get all collected blocks */
    getBlocks(): BlockMessage[];

    /** Get blocks by parent ID for hierarchical rendering */
    getBlocksByParent(parentId?: string): BlockMessage[];

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
    ): BlockMessage;

    /** Get statistics about collected blocks */
    getStats(): {
        total: number;
        byType: Record<string, number>;
        byState: Record<string, number>;
        rootBlocks: number;
    };

    /** Add event listener */
    addListener(listener: BlockCollectionListener): void;

    /** Remove event listener */
    removeListener(listener: BlockCollectionListener): void;
}

/**
 * Tool execution tracking data
 */
export interface ToolExecutionTrackingData {
    toolName: string;
    parameters: any;
    context?: ToolExecutionContext;
    startTime: Date;
    endTime?: Date;
    result?: any;
    error?: Error;
    executionId: string;
    parentBlockId?: string;
}

/**
 * Agent delegation tracking data for team scenarios
 */
export interface DelegationTrackingData {
    parentAgentId: string;
    delegatedAgentId: string;
    taskDescription: string;
    agentTemplate?: string;
    startTime: Date;
    endTime?: Date;
    result?: any;
    error?: Error;
    executionId: string;
    parentBlockId: string;
}

/**
 * Block tree structure for hierarchical visualization
 */
export interface BlockTreeNode {
    block: BlockMessage;
    children: BlockTreeNode[];
    parent?: BlockTreeNode;
}

/**
 * Block collection events for real-time updates
 */
export type BlockCollectionEvent =
    | { type: 'block_added'; block: BlockMessage }
    | { type: 'block_updated'; blockId: string; updates: Partial<BlockMetadata> }
    | { type: 'block_removed'; blockId: string }
    | { type: 'blocks_cleared' };

/**
 * Block collection listener
 */
export type BlockCollectionListener = (event: BlockCollectionEvent) => void; 