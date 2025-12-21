import type {
    ToolHooks,
    ToolExecutionContext,
    EventEmitterPlugin,
    HierarchicalEventData
} from '@robota-sdk/agents';
import { EVENT_EMITTER_EVENTS } from '@robota-sdk/agents';
import type { PlaygroundBlockCollector } from './block-collector';
import { ExecutionSubscriber } from '../execution-subscriber';
import { RealTimeLLMTracker } from '../llm-tracking/llm-tracker';

/**
 * Real-time tracking hooks options
 */
export interface RealTimeTrackingHooksOptions {
    /** Block collector to send updates to */
    blockCollector: PlaygroundBlockCollector;

    /** EventEmitter plugin for SDK integration */
    eventEmitter: EventEmitterPlugin;

    /** Function to get current agent history */
    getAgentHistory?: () => Array<{
        role: string;
        content: string;
        timestamp?: Date;
        metadata?: any;
    }>;

    /** LLM response check interval in milliseconds */
    llmCheckInterval?: number;
}

/**
 * 🔗 Real-Time Tracking Hooks Factory
 * 
 * Creates tool hooks that integrate with the enhanced tracking system.
 * Combines ExecutionSubscriber and RealTimeLLMTracker for complete real-time monitoring.
 * 
 * Key Features:
 * - Actual execution data only (no simulation)
 * - Hierarchical execution tracking
 * - Real-time LLM response detection
 * - Integration with enhanced EventEmitter events
 */
export function createRealTimeTrackingHooks(options: RealTimeTrackingHooksOptions): ToolHooks {
    const { blockCollector, eventEmitter, getAgentHistory, llmCheckInterval = 1000 } = options;

    // Initialize execution subscriber
    const executionSubscriber = new ExecutionSubscriber(blockCollector);
    executionSubscriber.initialize(eventEmitter);

    // Initialize LLM tracker if history getter is provided
    let llmTracker: RealTimeLLMTracker | undefined;
    if (getAgentHistory) {
        llmTracker = new RealTimeLLMTracker(blockCollector);
        llmTracker.startTracking(getAgentHistory, llmCheckInterval);
    }

    // Execution context map for tracking hierarchical relationships
    const executionContexts = new Map<string, {
        toolName: string;
        parentId?: string;
        level: number;
        path: string[];
        startTime: Date;
    }>();

    return {
        /**
         * Before tool execution - capture start context and emit hierarchical events
         */
        beforeExecute: async (toolName: string, parameters: any, context?: ToolExecutionContext) => {
            if (!context) return;

            const executionId = generateExecutionId();
            const startTime = new Date();

            // Extract hierarchical information from context
            const parentExecutionId = context.parentExecutionId;
            const rootExecutionId = context.rootExecutionId || executionId;
            const executionLevel = context.executionLevel ?? 2; // Default to tool level
            const executionPath = context.executionPath || [toolName];

            // Store execution context
            executionContexts.set(executionId, {
                toolName,
                parentId: parentExecutionId,
                level: executionLevel,
                path: executionPath,
                startTime
            });

            // Emit hierarchical event
            const hierarchicalEventData: HierarchicalEventData = {
                type: EVENT_EMITTER_EVENTS.EXECUTION_HIERARCHY,
                timestamp: startTime,
                executionId,
                data: {
                    toolName,
                    parameters
                },
                parentExecutionId,
                rootExecutionId,
                executionLevel,
                executionPath,
                realTimeData: {
                    startTime,
                    actualParameters: parameters
                }
            };

            eventEmitter.emit(EVENT_EMITTER_EVENTS.EXECUTION_HIERARCHY, hierarchicalEventData);
            eventEmitter.emit(EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE, {
                ...hierarchicalEventData,
                type: EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE
            });
        },

        /**
         * After successful tool execution - capture results and timing
         */
        afterExecute: async (toolName: string, parameters: any, result: any, context?: ToolExecutionContext) => {
            if (!context) return;

            const executionId = context.executionId || generateExecutionId();
            const endTime = new Date();

            const storedContext = executionContexts.get(executionId);
            const actualDuration = storedContext ?
                endTime.getTime() - storedContext.startTime.getTime() : 0;

            // Emit completion events with actual data
            const hierarchicalEventData: HierarchicalEventData = {
                type: EVENT_EMITTER_EVENTS.EXECUTION_REALTIME,
                timestamp: endTime,
                executionId,
                data: {
                    toolName,
                    result,
                    duration: actualDuration
                },
                parentExecutionId: context.parentExecutionId,
                rootExecutionId: context.rootExecutionId,
                executionLevel: context.executionLevel ?? 2,
                executionPath: context.executionPath || [toolName],
                realTimeData: {
                    startTime: storedContext?.startTime || new Date(),
                    actualDuration,
                    actualParameters: parameters,
                    actualResult: result
                }
            };

            eventEmitter.emit(EVENT_EMITTER_EVENTS.EXECUTION_REALTIME, hierarchicalEventData);
            eventEmitter.emit(EVENT_EMITTER_EVENTS.TOOL_AFTER_EXECUTE, {
                ...hierarchicalEventData,
                type: EVENT_EMITTER_EVENTS.TOOL_AFTER_EXECUTE
            });

            // Cleanup stored context
            executionContexts.delete(executionId);
        },

        /**
         * Error handling - capture error data
         */
        onError: async (toolName: string, parameters: any, error: Error, context?: ToolExecutionContext) => {
            if (!context) return;

            const executionId = context.executionId || generateExecutionId();
            const endTime = new Date();

            const storedContext = executionContexts.get(executionId);
            const actualDuration = storedContext ?
                endTime.getTime() - storedContext.startTime.getTime() : 0;

            // Emit error event with actual data
            const hierarchicalEventData: HierarchicalEventData = {
                type: EVENT_EMITTER_EVENTS.TOOL_ERROR,
                timestamp: endTime,
                executionId,
                error,
                data: {
                    toolName,
                    error: error.message,
                    duration: actualDuration
                },
                parentExecutionId: context.parentExecutionId,
                rootExecutionId: context.rootExecutionId,
                executionLevel: context.executionLevel ?? 2,
                executionPath: context.executionPath || [toolName],
                realTimeData: {
                    startTime: storedContext?.startTime || new Date(),
                    actualDuration,
                    actualParameters: parameters,
                    actualResult: error
                }
            };

            eventEmitter.emit(EVENT_EMITTER_EVENTS.TOOL_ERROR, hierarchicalEventData);

            // Cleanup stored context
            executionContexts.delete(executionId);
        }
    };
}

/**
 * Get estimated duration from tool if it supports ProgressReportingTool interface
 */
function getToolEstimatedDuration(context: ToolExecutionContext): number | undefined {
    // This would need to be connected to the actual tool instance
    // For now, return undefined as we only track actual data
    return undefined;
}

/**
 * Generate unique execution ID
 */
function generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
}

/**
 * Cleanup function for real-time tracking hooks
 */
export function cleanupRealTimeTracking(
    executionSubscriber: ExecutionSubscriber,
    llmTracker?: RealTimeLLMTracker
): void {
    executionSubscriber.dispose();
    if (llmTracker) {
        llmTracker.stopTracking();
        llmTracker.reset();
    }
} 