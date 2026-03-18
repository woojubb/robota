import type {
  IToolExecutionContext,
  ILogger,
  TToolParameters,
  TUniversalValue,
} from '@robota-sdk/agent-core';
import type {
  IBlockDataCollector,
  IBlockMessage,
  IToolExecutionTrackingData,
  IBlockMetadata,
} from './types';
import { SilentLogger } from '@robota-sdk/agent-core';

export interface IToolHooks {
  beforeExecute(
    toolName: string,
    parameters: TToolParameters,
    context?: IToolExecutionContext,
  ): Promise<void>;
  afterExecute(
    toolName: string,
    parameters: TToolParameters,
    result: TUniversalValue,
    context?: IToolExecutionContext,
  ): Promise<void>;
  onError(
    toolName: string,
    parameters: TToolParameters,
    error: Error,
    context?: IToolExecutionContext,
  ): Promise<void>;
}

/**
 * Create block tracking hooks that implement the universal IToolHooks interface
 * This connects the SDK's universal hook system to the web app's block visualization
 *
 * @param blockCollector - The block collector instance
 * @param logger - Optional logger for debugging
 * @param options - Additional configuration options
 */
export function createBlockTrackingHooks(
  blockCollector: IBlockDataCollector,
  logger: ILogger = SilentLogger,
  options: {
    /** Parent block ID for nested tool calls */
    parentBlockId?: string;
    /** Level for hierarchical nesting */
    level?: number;
    /** Custom block type mapping */
    blockTypeMapping?: Record<string, IBlockMetadata['type']>;
  } = {},
): IToolHooks {
  const { parentBlockId, level = 0, blockTypeMapping = {} } = options;

  // Track ongoing tool executions
  const activeExecutions = new Map<string, IToolExecutionTrackingData>();

  return {
    /**
     * Before tool execution: Create initial blocks
     */
    async beforeExecute(
      toolName: string,
      parameters: TToolParameters,
      context?: IToolExecutionContext,
    ): Promise<void> {
      try {
        const executionId = context?.executionId || blockCollector.generateBlockId();

        logger.debug('🟡 Block tracking: Starting tool execution', {
          toolName,
          executionId,
          parentBlockId,
        });

        // Track execution data
        const trackingData: IToolExecutionTrackingData = {
          toolName,
          parameters,
          context,
          startTime: new Date(),
          executionId,
          parentBlockId,
        };
        activeExecutions.set(executionId, trackingData);

        // Determine block type based on tool name
        const blockType = blockTypeMapping[toolName] || 'tool_call';

        // Create tool call block
        const toolCallBlock: IBlockMessage = {
          role: 'assistant',
          content: `🔧 ${toolName}`,
          blockMetadata: {
            id: blockCollector.generateBlockId(),
            type: blockType,
            level,
            parentId: parentBlockId,
            children: [],
            isExpanded: true,
            visualState: 'in_progress',
            executionContext: {
              toolName,
              executionId,
              timestamp: new Date(),
            },
            renderData: {
              parameters,
            },
          },
        };

        blockCollector.collectBlock(toolCallBlock);

        // Store block ID for later updates
        trackingData.parentBlockId = toolCallBlock.blockMetadata.id;
        activeExecutions.set(executionId, trackingData);
      } catch (error) {
        logger.error(
          '❌ Block tracking beforeExecute error:',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    },

    /**
     * After successful tool execution: Update blocks with results
     */
    async afterExecute(
      toolName: string,
      parameters: TToolParameters,
      result: TUniversalValue,
      context?: IToolExecutionContext,
    ): Promise<void> {
      try {
        const executionId = context?.executionId;

        if (!executionId) {
          logger.warn('⚠️ Block tracking: No executionId found for afterExecute');
          return;
        }

        const trackingData = activeExecutions.get(executionId);
        if (!trackingData) {
          logger.warn('⚠️ Block tracking: No tracking data found for executionId:', executionId);
          return;
        }

        trackingData.endTime = new Date();
        trackingData.result = result;

        const duration = trackingData.endTime.getTime() - trackingData.startTime.getTime();

        logger.debug('✅ Block tracking: Tool execution completed', {
          toolName,
          executionId,
          duration: `${duration}ms`,
        });

        // Update the tool call block with success state
        if (trackingData.parentBlockId) {
          blockCollector.updateBlock(trackingData.parentBlockId, {
            visualState: 'completed',
            executionContext: {
              toolName,
              executionId,
              timestamp: trackingData.startTime,
              duration,
            },
            renderData: {
              parameters,
              result,
            },
          });

          // Create result block as child
          const resultBlock: IBlockMessage = {
            role: 'system',
            content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            blockMetadata: {
              id: blockCollector.generateBlockId(),
              type: 'tool_result',
              level: level + 1,
              parentId: trackingData.parentBlockId,
              children: [],
              isExpanded: false,
              visualState: 'completed',
              executionContext: {
                toolName,
                executionId,
                timestamp: trackingData.endTime,
                duration,
              },
              renderData: {
                result,
              },
            },
          };

          blockCollector.collectBlock(resultBlock);
        }

        // Clean up tracking data
        activeExecutions.delete(executionId);
      } catch (error) {
        logger.error(
          '❌ Block tracking afterExecute error:',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    },

    /**
     * On tool execution error: Update blocks with error state
     */
    async onError(
      toolName: string,
      parameters: TToolParameters,
      error: Error,
      context?: IToolExecutionContext,
    ): Promise<void> {
      try {
        const executionId = context?.executionId;

        if (!executionId) {
          logger.warn('⚠️ Block tracking: No executionId found for onError');
          return;
        }

        const trackingData = activeExecutions.get(executionId);
        if (!trackingData) {
          logger.warn('⚠️ Block tracking: No tracking data found for error:', executionId);
          return;
        }

        trackingData.endTime = new Date();
        trackingData.error = error;

        const duration = trackingData.endTime.getTime() - trackingData.startTime.getTime();

        logger.error('❌ Block tracking: Tool execution failed', {
          toolName,
          executionId,
          error: error.message,
          duration: `${duration}ms`,
        });

        // Update the tool call block with error state
        if (trackingData.parentBlockId) {
          blockCollector.updateBlock(trackingData.parentBlockId, {
            visualState: 'error',
            executionContext: {
              toolName,
              executionId,
              timestamp: trackingData.startTime,
              duration,
            },
            renderData: {
              parameters,
              error,
            },
          });

          // Create error block as child
          const errorBlock: IBlockMessage = {
            role: 'system',
            content: `❌ Error: ${error.message}`,
            blockMetadata: {
              id: blockCollector.generateBlockId(),
              type: 'error',
              level: level + 1,
              parentId: trackingData.parentBlockId,
              children: [],
              isExpanded: true,
              visualState: 'error',
              executionContext: {
                toolName,
                executionId,
                timestamp: trackingData.endTime,
                duration,
              },
              renderData: {
                error,
              },
            },
          };

          blockCollector.collectBlock(errorBlock);
        }

        // Clean up tracking data
        activeExecutions.delete(executionId);
      } catch (hookError) {
        logger.error(
          '❌ Block tracking onError handler error:',
          hookError instanceof Error ? hookError : new Error(String(hookError)),
        );
      }
    },
  };
}

/**
 * Create delegation tracking hooks for team agent scenarios
 * Tracks when agents delegate tasks to other agents
 */
export function createDelegationTrackingHooks(
  blockCollector: IBlockDataCollector,
  logger: ILogger = SilentLogger,
  options: {
    parentBlockId?: string;
    level?: number;
  } = {},
): IToolHooks {
  return createBlockTrackingHooks(blockCollector, logger, {
    ...options,
    blockTypeMapping: {
      assignTask: 'tool_call',
      delegate_to_agent: 'tool_call',
    },
  });
}
