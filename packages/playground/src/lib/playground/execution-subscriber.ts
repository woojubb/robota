import type {
    EventEmitterPlugin,
    IEventEmitterEventData,
    IEventEmitterHierarchicalEventData
} from '@robota-sdk/agents';
import { EVENT_EMITTER_EVENTS } from '@robota-sdk/agents';
import type { PlaygroundBlockCollector } from './block-tracking/block-collector';
import type { IRealTimeBlockMessage, IRealTimeBlockMetadata } from './block-tracking/types';

/**
 * 🔗 ExecutionSubscriber - Bridges SDK events to Web App BlockCollector
 * 
 * Subscribes to SDK events and converts them to real-time block updates.
 * Follows "actual data only" principle - no simulation or fake progress.
 */
export class ExecutionSubscriber {
    private blockCollector: PlaygroundBlockCollector;
    private eventEmitter?: EventEmitterPlugin;
    private unsubscribeFunctions: (() => void)[] = [];
    private activeExecutions = new Map<string, {
        blockId: string;
        startTime: Date;
        hierarchyInfo?: {
            parentExecutionId?: string;
            rootExecutionId?: string;
            level: number;
            path: string[];
        };
    }>();

    constructor(blockCollector: PlaygroundBlockCollector) {
        this.blockCollector = blockCollector;
    }

    /**
     * Initialize with EventEmitterPlugin
     */
    initialize(eventEmitter: EventEmitterPlugin): void {
        this.eventEmitter = eventEmitter;
        this.subscribeToEvents();
    }

    /**
     * Subscribe to relevant SDK events
     */
    private subscribeToEvents(): void {
        if (!this.eventEmitter) return;

        // Subscribe to tool execution events
        this.eventEmitter.on(EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE, this.onToolStart.bind(this));
        this.eventEmitter.on(EVENT_EMITTER_EVENTS.TOOL_AFTER_EXECUTE, this.onToolComplete.bind(this));
        this.eventEmitter.on(EVENT_EMITTER_EVENTS.TOOL_ERROR, this.onToolError.bind(this));

        // Subscribe to hierarchical events
        this.eventEmitter.on(EVENT_EMITTER_EVENTS.EXECUTION_HIERARCHY, (eventData: IEventEmitterEventData) => {
            this.onHierarchyUpdate(eventData as IEventEmitterHierarchicalEventData);
        });
        this.eventEmitter.on(EVENT_EMITTER_EVENTS.EXECUTION_REALTIME, (eventData: IEventEmitterEventData) => {
            this.onRealtimeUpdate(eventData as IEventEmitterHierarchicalEventData);
        });
        this.eventEmitter.on(EVENT_EMITTER_EVENTS.TOOL_REALTIME, this.onToolRealtimeUpdate.bind(this));

        // Subscribe to execution lifecycle events
        this.eventEmitter.on(EVENT_EMITTER_EVENTS.EXECUTION_START, this.onExecutionStart.bind(this));
        this.eventEmitter.on(EVENT_EMITTER_EVENTS.EXECUTION_COMPLETE, this.onExecutionComplete.bind(this));
    }

    /**
     * Handle tool execution start
     */
    private onToolStart(eventData: IEventEmitterEventData): void {
        const executionId = eventData.executionId;
        if (!executionId) return;

        const hierarchicalData = eventData as IEventEmitterHierarchicalEventData;
        const toolName = (eventData.data as any)?.toolName || 'unknown_tool';

        // Create real-time block metadata
        const blockMetadata: IRealTimeBlockMetadata = {
            id: this.generateBlockId(),
            type: 'tool_call',
            level: hierarchicalData.executionLevel || 2,
            parentId: this.getParentBlockId(hierarchicalData.parentExecutionId),
            children: [],
            isExpanded: true,
            visualState: 'in_progress',

            // Real execution timing data
            startTime: new Date(),

            // Real execution data
            toolParameters: hierarchicalData.realTimeData?.actualParameters,

            // Hierarchical execution context
            executionHierarchy: hierarchicalData.executionLevel !== undefined ? {
                parentExecutionId: hierarchicalData.parentExecutionId,
                rootExecutionId: hierarchicalData.rootExecutionId,
                level: hierarchicalData.executionLevel,
                path: hierarchicalData.executionPath || [toolName]
            } : undefined,

            // Execution context
            executionContext: {
                toolName,
                executionId,
                timestamp: new Date()
            },

            // Render data
            renderData: {
                parameters: hierarchicalData.realTimeData?.actualParameters
            }
        };

        // Create block message
        const blockMessage: IRealTimeBlockMessage = {
            role: 'tool',
            content: `Executing ${toolName}...`,
            blockMetadata
        };

        // Store execution info
        this.activeExecutions.set(executionId, {
            blockId: blockMetadata.id,
            startTime: blockMetadata.startTime!,
            hierarchyInfo: blockMetadata.executionHierarchy
        });

        // Add block to collector
        this.blockCollector.collectBlock(blockMessage);
    }

    /**
     * Handle tool execution completion
     */
    private onToolComplete(eventData: IEventEmitterEventData): void {
        const executionId = eventData.executionId;
        if (!executionId) return;

        const execution = this.activeExecutions.get(executionId);
        if (!execution) return;

        const hierarchicalData = eventData as IEventEmitterHierarchicalEventData;
        const endTime = new Date();
        const actualDuration = endTime.getTime() - execution.startTime.getTime();

        // Update block with completion data
        this.blockCollector.updateRealTimeBlock(execution.blockId, {
            visualState: 'completed',
            endTime,
            actualDuration,
            toolResult: hierarchicalData.realTimeData?.actualResult?.data,
            renderData: {
                result: hierarchicalData.realTimeData?.actualResult?.data
            }
        });

        // Clean up execution tracking
        this.activeExecutions.delete(executionId);
    }

    /**
     * Handle tool execution error
     */
    private onToolError(eventData: IEventEmitterEventData): void {
        const executionId = eventData.executionId;
        if (!executionId) return;

        const execution = this.activeExecutions.get(executionId);
        if (!execution) return;

        const endTime = new Date();
        const actualDuration = endTime.getTime() - execution.startTime.getTime();

        // Update block with error data
        this.blockCollector.updateRealTimeBlock(execution.blockId, {
            visualState: 'error',
            endTime,
            actualDuration,
            renderData: {
                error: eventData.error
            }
        });

        // Clean up execution tracking
        this.activeExecutions.delete(executionId);
    }

    /**
     * Handle hierarchy updates
     */
    private onHierarchyUpdate(eventData: IEventEmitterHierarchicalEventData): void {
        const executionId = eventData.executionId;
        if (!executionId) return;

        const execution = this.activeExecutions.get(executionId);
        if (!execution) return;

        // Update hierarchy information
        execution.hierarchyInfo = {
            parentExecutionId: eventData.parentExecutionId,
            rootExecutionId: eventData.rootExecutionId,
            level: eventData.executionLevel,
            path: eventData.executionPath
        };

        // Update block hierarchy
        this.blockCollector.updateRealTimeBlock(execution.blockId, {
            level: eventData.executionLevel,
            executionHierarchy: execution.hierarchyInfo
        });
    }

    /**
     * Handle real-time updates
     */
    private onRealtimeUpdate(eventData: IEventEmitterHierarchicalEventData): void {
        const executionId = eventData.executionId;
        if (!executionId || !eventData.realTimeData) return;

        const execution = this.activeExecutions.get(executionId);
        if (!execution) return;

        // Update with real-time data
        this.blockCollector.updateRealTimeBlock(execution.blockId, {
            toolParameters: eventData.realTimeData.actualParameters,
            toolResult: eventData.realTimeData.actualResult?.data,
            renderData: {
                parameters: eventData.realTimeData.actualParameters,
                result: eventData.realTimeData.actualResult?.data
            }
        });
    }

    /**
     * Handle tool-specific real-time updates (progress, etc.)
     */
    private onToolRealtimeUpdate(eventData: IEventEmitterEventData): void {
        const executionId = eventData.executionId;
        if (!executionId) return;

        const execution = this.activeExecutions.get(executionId);
        if (!execution) return;

        // Update tool-provided data if available
        const toolData = (eventData.data as any);
        if (toolData?.progress !== undefined || toolData?.currentStep) {
            this.blockCollector.updateRealTimeBlock(execution.blockId, {
                toolProvidedData: {
                    progress: toolData.progress,
                    currentStep: toolData.currentStep,
                    estimatedDuration: toolData.estimatedDuration,
                    executionSteps: toolData.executionSteps
                }
            });
        }
    }

    /**
     * Handle execution start (Team/Agent level)
     */
    private onExecutionStart(eventData: IEventEmitterEventData): void {
        // For Agent/Team level executions, we can create group blocks
        const executionId = eventData.executionId;
        if (!executionId) return;

        const hierarchicalData = eventData as IEventEmitterHierarchicalEventData;

        // Only create blocks for Agent/Team level (level 0 or 1)
        if (hierarchicalData.executionLevel !== undefined && hierarchicalData.executionLevel <= 1) {
            const blockMetadata: IRealTimeBlockMetadata = {
                id: this.generateBlockId(),
                type: hierarchicalData.executionLevel === 0 ? 'group' : 'assistant',
                level: hierarchicalData.executionLevel,
                parentId: this.getParentBlockId(hierarchicalData.parentExecutionId),
                children: [],
                isExpanded: true,
                visualState: 'in_progress',
                startTime: new Date(),
                executionHierarchy: {
                    parentExecutionId: hierarchicalData.parentExecutionId,
                    rootExecutionId: hierarchicalData.rootExecutionId,
                    level: hierarchicalData.executionLevel,
                    path: hierarchicalData.executionPath || []
                },
                executionContext: {
                    executionId,
                    timestamp: new Date()
                }
            };

            const blockMessage: IRealTimeBlockMessage = {
                role: hierarchicalData.executionLevel === 0 ? 'system' : 'assistant',
                content: hierarchicalData.executionLevel === 0 ? 'Team execution started' : 'Agent processing...',
                blockMetadata
            };

            this.activeExecutions.set(executionId, {
                blockId: blockMetadata.id,
                startTime: blockMetadata.startTime!,
                hierarchyInfo: blockMetadata.executionHierarchy
            });

            this.blockCollector.collectBlock(blockMessage);
        }
    }

    /**
     * Handle execution completion (Team/Agent level)
     */
    private onExecutionComplete(eventData: IEventEmitterEventData): void {
        const executionId = eventData.executionId;
        if (!executionId) return;

        const execution = this.activeExecutions.get(executionId);
        if (!execution) return;

        const endTime = new Date();
        const actualDuration = endTime.getTime() - execution.startTime.getTime();

        this.blockCollector.updateRealTimeBlock(execution.blockId, {
            visualState: 'completed',
            endTime,
            actualDuration
        });

        this.activeExecutions.delete(executionId);
    }

    /**
     * Get parent block ID from parent execution ID
     */
    private getParentBlockId(parentExecutionId?: string): string | undefined {
        if (!parentExecutionId) return undefined;

        const parentExecution = this.activeExecutions.get(parentExecutionId);
        return parentExecution?.blockId;
    }

    /**
     * Generate unique block ID
     */
    private generateBlockId(): string {
        return `block_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    /**
     * Cleanup - unsubscribe from all events
     */
    dispose(): void {
        this.unsubscribeFunctions.forEach(unsubscribe => unsubscribe());
        this.unsubscribeFunctions = [];
        this.activeExecutions.clear();
    }
} 