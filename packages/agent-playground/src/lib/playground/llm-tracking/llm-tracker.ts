const RANDOM_ID_BASE = 36;
const RANDOM_ID_LENGTH = 6;

import type { IPlaygroundBlockCollector } from '../block-tracking/block-collector';
import type {
  IBlockMetadata,
  IRealTimeBlockMessage,
  IRealTimeBlockMetadata,
} from '../block-tracking/types';
import type { TUniversalValue } from '@robota-sdk/agent-core';

/**
 * Type guard: checks whether block metadata has the executionHierarchy field
 * present in IRealTimeBlockMetadata but not in the base IBlockMetadata.
 */
function isRealTimeBlockMetadata(meta: IBlockMetadata): meta is IRealTimeBlockMetadata {
  return 'executionHierarchy' in meta && 'visualState' in meta;
}

/**
 * LLM response data from Agent history
 */
interface ILLMResponseData {
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
  private blockCollector: IPlaygroundBlockCollector;
  private trackedResponsesCount = 0;
  private responseCheckInterval?: NodeJS.Timeout;
  private lastHistoryLength = 0;

  constructor(blockCollector: IPlaygroundBlockCollector) {
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
      metadata?: Record<string, TUniversalValue>;
    }>,
    checkIntervalMs = 1000,
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
      metadata?: Record<string, TUniversalValue>;
    }>,
  ): void {
    // Only process if history has grown
    if (history.length <= this.lastHistoryLength) {
      return;
    }

    // Check new messages since last check
    const newMessages = history.slice(this.lastHistoryLength);

    for (const message of newMessages) {
      if (message.role === 'assistant' && message.content) {
        const metadata = message.metadata;
        const agentId =
          metadata && typeof metadata.agentId === 'string' ? metadata.agentId : undefined;
        const executionId =
          metadata && typeof metadata.executionId === 'string' ? metadata.executionId : undefined;
        const tokensUsed =
          metadata && typeof metadata.tokensUsed === 'number' ? metadata.tokensUsed : undefined;
        const duration =
          metadata && typeof metadata.duration === 'number' ? metadata.duration : undefined;
        const model = metadata && typeof metadata.model === 'string' ? metadata.model : undefined;
        const parentExecutionId =
          metadata && typeof metadata.parentExecutionId === 'string'
            ? metadata.parentExecutionId
            : undefined;

        this.processLLMResponse({
          content: message.content,
          timestamp: message.timestamp || new Date(),
          agentId,
          executionId,
          tokensUsed,
          duration,
          model,
          parentExecutionId,
        });
      }
    }

    this.lastHistoryLength = history.length;
  }

  /**
   * Process a detected LLM response
   */
  private processLLMResponse(responseData: ILLMResponseData): void {
    this.trackedResponsesCount += 1;

    // Find parent block based on execution context
    const parentBlockId = this.findParentBlockId(responseData);

    // Create LLM response block metadata
    const blockMetadata: IRealTimeBlockMetadata = {
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
        duration: responseData.duration,
      },

      // Hierarchical execution context
      executionHierarchy: responseData.parentExecutionId
        ? {
            parentExecutionId: responseData.parentExecutionId,
            level: this.calculateLevel(parentBlockId),
            path: this.calculatePath(parentBlockId, 'llm_response'),
          }
        : undefined,

      // Render data
      renderData: {
        reasoning: 'LLM Response',
        parameters: {
          model: responseData.model,
          tokensUsed: responseData.tokensUsed,
        },
      },
    };

    // Create block message
    const blockMessage: IRealTimeBlockMessage = {
      role: 'assistant',
      content: responseData.content,
      timestamp: responseData.timestamp,
      metadata: {
        agentId: responseData.agentId,
        executionId: responseData.executionId,
        tokensUsed: responseData.tokensUsed,
        model: responseData.model,
      },
      blockMetadata,
    };

    // Add block to collector
    this.blockCollector.collectBlock(blockMessage);

    // Update parent block to include this as a child
    if (parentBlockId) {
      const parentBlock = this.blockCollector.getBlock(parentBlockId);
      if (parentBlock) {
        this.blockCollector.updateRealTimeBlock(parentBlockId, {
          children: [...parentBlock.blockMetadata.children, blockMetadata.id],
        });
      }
    }
  }

  /**
   * Find the parent block ID for this LLM response
   */
  private findParentBlockId(responseData: ILLMResponseData): string | undefined {
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

    // Build path from parent's hierarchy using type guard instead of downcast
    const parentMetadata = parentBlock.blockMetadata;
    const parentPath = isRealTimeBlockMetadata(parentMetadata)
      ? (parentMetadata.executionHierarchy?.path ?? [])
      : [];

    return [...parentPath, currentStep];
  }

  /**
   * Generate unique block ID
   */
  private generateBlockId(): string {
    return `llm_block_${Date.now()}_${Math.random().toString(RANDOM_ID_BASE).substr(2, RANDOM_ID_LENGTH)}`;
  }

  /**
   * Reset tracking state
   */
  reset(): void {
    this.trackedResponsesCount = 0;
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
      trackedResponses: this.trackedResponsesCount,
      isTracking: this.responseCheckInterval !== undefined,
      lastHistoryLength: this.lastHistoryLength,
    };
  }
}
