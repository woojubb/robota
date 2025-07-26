import type { PlaygroundBlockCollector } from '../block-tracking/block-collector';
import type { RealTimeBlockMessage, RealTimeBlockMetadata } from '../block-tracking/types';

/**
 * LLM response data from Agent history
 */
interface LLMResponseData {
    content: string;
    timestamp: Date;
    agentId?: string;
    executionId?: string;
    tokensUsed?: number;
    duration?: number;
    model?: string;
    parentExecutionId?: string;
}

/**
 * 🧠 RealTimeLLMTracker - Detects and tracks actual LLM responses
 * 
 * Monitors Agent history to detect when LLM responses are generated
 * and creates corresponding blocks with actual response data.
 * 
 * Follows "actual data only" principle - only tracks real LLM responses.
 */
export class RealTimeLLMTracker {
    private blockCollector: PlaygroundBlockCollector;
    private trackedResponses = new Set<string>();
    private responseCheckInterval?: NodeJS.Timeout;
    private lastHistoryLength = 0;

    constructor(blockCollector: PlaygroundBlockCollector) {
        this.blockCollector = blockCollector;
    }

    /**
     * Start monitoring for LLM responses
     */
    startTracking(
        getAgentHistory: () => Array<{
            role: string;
            content: string;
            timestamp?: Date;
            metadata?: any;
        }>,
        checkIntervalMs = 1000
    ): void {
        this.responseCheckInterval = setInterval(() => {
            this.checkForNewResponses(getAgentHistory());
        }, checkIntervalMs);
    }

    /**
     * Stop monitoring for LLM responses
     */
    stopTracking(): void {
        if (this.responseCheckInterval) {
            clearInterval(this.responseCheckInterval);
            this.responseCheckInterval = undefined;
        }
    }

    /**
     * Manually check for new LLM responses
     */
    checkForNewResponses(
        history: Array<{
            role: string;
            content: string;
            timestamp?: Date;
            metadata?: any;
        }>
    ): void {
        // Only process if history has grown
        if (history.length <= this.lastHistoryLength) {
            return;
        }

        // Check new messages since last check
        const newMessages = history.slice(this.lastHistoryLength);

        for (const message of newMessages) {
            if (message.role === 'assistant' && message.content) {
                this.processLLMResponse({
                    content: message.content,
                    timestamp: message.timestamp || new Date(),
                    agentId: message.metadata?.agentId,
                    executionId: message.metadata?.executionId,
                    tokensUsed: message.metadata?.tokensUsed,
                    duration: message.metadata?.duration,
                    model: message.metadata?.model,
                    parentExecutionId: message.metadata?.parentExecutionId
                });
            }
        }

        this.lastHistoryLength = history.length;
    }

    /**
     * Process a detected LLM response
     */
    private processLLMResponse(responseData: LLMResponseData): void {
        const responseId = this.generateResponseId(responseData);

        // Skip if already processed
        if (this.trackedResponses.has(responseId)) {
            return;
        }

        this.trackedResponses.add(responseId);

        // Find parent block based on execution context
        const parentBlockId = this.findParentBlockId(responseData);

        // Create LLM response block metadata
        const blockMetadata: RealTimeBlockMetadata = {
            id: this.generateBlockId(),
            type: 'assistant',
            level: this.calculateLevel(parentBlockId),
            parentId: parentBlockId,
            children: [],
            isExpanded: true,
            visualState: 'completed',

            // Real execution timing data
            startTime: responseData.timestamp,
            endTime: responseData.timestamp, // LLM response is instantaneous from our perspective
            actualDuration: responseData.duration || 0,

            // Execution context
            executionContext: {
                agentId: responseData.agentId,
                executionId: responseData.executionId,
                timestamp: responseData.timestamp,
                duration: responseData.duration
            },

            // Hierarchical execution context
            executionHierarchy: responseData.parentExecutionId ? {
                parentExecutionId: responseData.parentExecutionId,
                level: this.calculateLevel(parentBlockId),
                path: this.calculatePath(parentBlockId, 'llm_response')
            } : undefined,

            // Render data
            renderData: {
                reasoning: 'LLM Response',
                parameters: {
                    model: responseData.model,
                    tokensUsed: responseData.tokensUsed
                }
            }
        };

        // Create block message
        const blockMessage: RealTimeBlockMessage = {
            role: 'assistant',
            content: responseData.content,
            timestamp: responseData.timestamp,
            metadata: {
                agentId: responseData.agentId,
                executionId: responseData.executionId,
                tokensUsed: responseData.tokensUsed,
                model: responseData.model
            },
            blockMetadata
        };

        // Add block to collector
        this.blockCollector.collectBlock(blockMessage);

        // Update parent block to include this as a child
        if (parentBlockId) {
            const parentBlock = this.blockCollector.getBlock(parentBlockId);
            if (parentBlock && !parentBlock.blockMetadata.children.includes(blockMetadata.id)) {
                this.blockCollector.updateRealTimeBlock(parentBlockId, {
                    children: [...parentBlock.blockMetadata.children, blockMetadata.id]
                });
            }
        }
    }

    /**
     * Find the parent block ID for this LLM response
     */
    private findParentBlockId(responseData: LLMResponseData): string | undefined {
        if (!responseData.parentExecutionId) {
            return undefined;
        }

        // Search through all blocks to find one with matching execution context
        const allBlocks = this.blockCollector.getBlocks();

        for (const block of allBlocks) {
            const execContext = block.blockMetadata.executionContext;
            if (execContext?.executionId === responseData.parentExecutionId) {
                return block.blockMetadata.id;
            }
        }

        return undefined;
    }

    /**
     * Calculate the hierarchical level for the LLM response block
     */
    private calculateLevel(parentBlockId?: string): number {
        if (!parentBlockId) {
            return 1; // Root level assistant response
        }

        const parentBlock = this.blockCollector.getBlock(parentBlockId);
        return parentBlock ? parentBlock.blockMetadata.level + 1 : 1;
    }

    /**
     * Calculate the execution path for this LLM response
     */
    private calculatePath(parentBlockId?: string, currentStep = 'llm_response'): string[] {
        if (!parentBlockId) {
            return [currentStep];
        }

        const parentBlock = this.blockCollector.getBlock(parentBlockId);
        if (!parentBlock) {
            return [currentStep];
        }

        // Build path from parent's hierarchy
        const parentMetadata = parentBlock.blockMetadata as RealTimeBlockMetadata;
        const parentPath = parentMetadata.executionHierarchy?.path || [];

        return [...parentPath, currentStep];
    }

    /**
     * Generate unique response ID for deduplication
     */
    private generateResponseId(responseData: LLMResponseData): string {
        const key = `${responseData.executionId || 'unknown'}_${responseData.timestamp.getTime()}_${responseData.content.substring(0, 50)}`;
        return btoa(key).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
    }

    /**
     * Generate unique block ID
     */
    private generateBlockId(): string {
        return `llm_block_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    /**
     * Reset tracking state
     */
    reset(): void {
        this.trackedResponses.clear();
        this.lastHistoryLength = 0;
        this.stopTracking();
    }

    /**
     * Get tracking statistics
     */
    getStats(): {
        trackedResponses: number;
        isTracking: boolean;
        lastHistoryLength: number;
    } {
        return {
            trackedResponses: this.trackedResponses.size,
            isTracking: this.responseCheckInterval !== undefined,
            lastHistoryLength: this.lastHistoryLength
        };
    }
} 