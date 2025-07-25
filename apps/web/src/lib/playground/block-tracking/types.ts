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
 * Enhanced message with block-specific metadata
 */
export interface BlockMessage extends UniversalMessage {
    /** Block metadata for visual representation */
    blockMetadata: BlockMetadata;
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