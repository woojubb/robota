import type {
    EventEmitterPlugin,
    EventData,
    HierarchicalEventData
} from '@robota-sdk/agents';
import type { PlaygroundBlockCollector } from './block-tracking/block-collector';
import type { RealTimeBlockMessage, RealTimeBlockMetadata } from './block-tracking/types';

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
        this.eventEmitter.on('tool.beforeExecute', this.onToolStart.bind(this));
        this.eventEmitter.on('tool.afterExecute', this.onToolComplete.bind(this));
        this.eventEmitter.on('tool.error', this.onToolError.bind(this));

        // Subscribe to hierarchical events
        this.eventEmitter.on('execution.hierarchy', (eventData: EventData) => {
            this.onHierarchyUpdate(eventData as HierarchicalEventData);
        });
        this.eventEmitter.on('execution.realtime', (eventData: EventData) => {
            this.onRealtimeUpdate(eventData as HierarchicalEventData);
        });
        this.eventEmitter.on('tool.realtime', this.onToolRealtimeUpdate.bind(this));

        // Subscribe to execution lifecycle events
        this.eventEmitter.on('execution.start', this.onExecutionStart.bind(this));
        this.eventEmitter.on('execution.complete', this.onExecutionComplete.bind(this));
    }

    /**
     * Handle tool execution start
     */
    private onToolStart(eventData: EventData): void {
        const executionId = eventData.executionId;
        if (!executionId) return;

        const hierarchicalData = eventData as HierarchicalEventData;
        const toolName = (eventData.data as any)?.toolName || 'unknown_tool';

        // Create real-time block metadata
        const blockMetadata: RealTimeBlockMetadata = {
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
        const blockMessage: RealTimeBlockMessage = {
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
    private onToolComplete(eventData: EventData): void {
        const executionId = eventData.executionId;
        if (!executionId) return;

        const execution = this.activeExecutions.get(executionId);
        if (!execution) return;

        const hierarchicalData = eventData as HierarchicalEventData;
        const endTime = new Date();
        const actualDuration = endTime.getTime() - execution.startTime.getTime();

        // Update block with completion data
        this.blockCollector.updateRealTimeBlock(execution.blockId, {
            visualState: 'completed',
            endTime,
            actualDuration,
            toolResult: hierarchicalData.realTimeData?.actualResult,
            renderData: {
                result: hierarchicalData.realTimeData?.actualResult
            }
        });

        // Clean up execution tracking
        this.activeExecutions.delete(executionId);
    }

    /**
     * Handle tool execution error
     */
    private onToolError(eventData: EventData): void {
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
    private onHierarchyUpdate(eventData: HierarchicalEventData): void {
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
    private onRealtimeUpdate(eventData: HierarchicalEventData): void {
        const executionId = eventData.executionId;
        if (!executionId || !eventData.realTimeData) return;

        const execution = this.activeExecutions.get(executionId);
        if (!execution) return;

        // Update with real-time data
        this.blockCollector.updateRealTimeBlock(execution.blockId, {
            toolParameters: eventData.realTimeData.actualParameters,
            toolResult: eventData.realTimeData.actualResult,
            renderData: {
                parameters: eventData.realTimeData.actualParameters,
                result: eventData.realTimeData.actualResult
            }
        });
    }

    /**
     * Handle tool-specific real-time updates (progress, etc.)
     */
    private onToolRealtimeUpdate(eventData: EventData): void {
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
    private onExecutionStart(eventData: EventData): void {
        // For Agent/Team level executions, we can create group blocks
        const executionId = eventData.executionId;
        if (!executionId) return;

        const hierarchicalData = eventData as HierarchicalEventData;

        // Only create blocks for Agent/Team level (level 0 or 1)
        if (hierarchicalData.executionLevel !== undefined && hierarchicalData.executionLevel <= 1) {
            const blockMetadata: RealTimeBlockMetadata = {
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

            const blockMessage: RealTimeBlockMessage = {
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
    private onExecutionComplete(eventData: EventData): void {
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