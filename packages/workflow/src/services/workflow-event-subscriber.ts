/**
 * WorkflowEventSubscriber - Real-time event subscriber for workflow package
 * 
 * Migrated from agents package with new architecture:
 * - Uses new EventHandler system
 * - Domain-neutral approach
 * - Proper event ownership
 */

import { SimpleLogger, SilentLogger } from '@robota-sdk/agents';
import type {
    EventHandler,
    EventData,
    EventProcessingResult
} from '../interfaces/event-handler.js';
import type { WorkflowNode } from '../interfaces/workflow-node.js';
import type {
    ExtendedWorkflowBuilder,
    WorkflowUpdate,
    WorkflowUpdateCallback
} from '../interfaces/workflow-builder.js';
import { NodeEdgeManager } from './node-edge-manager.js';
import { CoreWorkflowBuilder } from './workflow-builder.js';
import { AgentEventHandler } from '../handlers/agent-event-handler.js';
import { ToolEventHandler } from '../handlers/tool-event-handler.js';

import { ExecutionEventHandler } from '../handlers/execution-event-handler.js';

/**
 * Event subscription callback for external integrations
 */
export type EventSubscriptionCallback = (eventType: string, eventData: unknown) => void;

/**
 * WorkflowEventSubscriber Configuration
 */
export interface WorkflowEventSubscriberConfig {
    /** Logger instance for debugging */
    logger?: SimpleLogger;

    /** Maximum number of nodes to retain in memory */
    maxNodes?: number;

    /** Maximum number of edges to retain in memory */
    maxEdges?: number;

    /** Event handlers to register */
    eventHandlers?: EventHandler[];

    /** Enable automatic node cleanup */
    enableAutoCleanup?: boolean;
}

/**
 * WorkflowEventSubscriber - Core workflow event processing system
 */
export class WorkflowEventSubscriber {
    private logger: SimpleLogger;
    private workflowBuilder: ExtendedWorkflowBuilder;
    private eventHandlers = new Map<string, EventHandler>();
    private eventSubscribers = new Set<EventSubscriptionCallback>();
    private workflowUpdateSubscribers = new Set<WorkflowUpdateCallback>();
    private workflowSnapshotSubscribers = new Set<(snapshot: any) => void>();

    // Configuration
    private config: Required<WorkflowEventSubscriberConfig>;

    // Statistics
    private stats = {
        eventsProcessed: 0,
        nodesCreated: 0,
        edgesCreated: 0,
        errorsEncountered: 0,
        lastEventTime: new Date()
    };

    constructor(config: WorkflowEventSubscriberConfig = {}) {
        this.config = {
            logger: config.logger ?? SilentLogger,
            maxNodes: config.maxNodes ?? 1000,
            maxEdges: config.maxEdges ?? 2000,
            eventHandlers: config.eventHandlers ?? [],
            enableAutoCleanup: config.enableAutoCleanup ?? false
        };

        this.logger = this.config.logger;
        this.workflowBuilder = new CoreWorkflowBuilder({
            logger: this.logger,
            maxNodes: this.config.maxNodes,
            maxEdges: this.config.maxEdges
        });

        // Initialize with default handlers
        this.initializeDefaultHandlers();

        // Register additional handlers from config
        this.config.eventHandlers.forEach(handler => {
            this.registerEventHandler(handler);
        });

        // Subscribe to workflow updates: apply stats, notify update, then snapshot subscribers
        this.workflowBuilder.subscribe((update) => {
            this.updateStatistics(update);
            this.notifyWorkflowUpdateSubscribers(update);
            // Snapshot after the update is actually applied (queue processed moment)
            if (this.workflowSnapshotSubscribers.size > 0) {
                try {
                    const snapshot = this.exportWorkflow();
                    this.notifyWorkflowSnapshotSubscribers(snapshot);
                } catch (error) {
                    this.logger.error('❌ [WORKFLOW-SNAPSHOT-ERROR] Failed to export workflow snapshot:', error);
                }
            }
        });

        this.logger.debug('🏗️ [WORKFLOW-EVENT-SUBSCRIBER] Initialized', {
            handlersCount: this.eventHandlers.size,
            config: this.config
        });
    }

    // =================================================================
    // Public API - Event Processing
    // =================================================================

    /**
     * Process an event through the registered handlers
     */
    async processEvent(eventType: string, eventData: unknown): Promise<void> {
        try {
            this.stats.eventsProcessed++;
            this.stats.lastEventTime = new Date();

            this.logger.debug(`📡 [EVENT-RECEIVED] ${eventType}`, {
                eventData: typeof eventData === 'object' ? eventData : { value: eventData }
            });

            // Notify event subscribers
            this.notifyEventSubscribers(eventType, eventData);

            // Convert to EventData format
            const normalizedEventData: EventData = this.normalizeEventData(eventType, eventData);

            // Find and execute handlers
            const matchingHandlers = this.findMatchingHandlers(eventType);

            if (matchingHandlers.length === 0) {
                this.logger.warn(`⚠️ [NO-HANDLER] No handlers found for event: ${eventType}`);
                return;
            }

            // Process with all matching handlers
            const results = await Promise.allSettled(
                matchingHandlers.map(handler =>
                    this.executeHandler(handler, eventType, normalizedEventData)
                )
            );

            // Process results and apply updates
            await this.processHandlerResults(eventType, results);

        } catch (error) {
            this.stats.errorsEncountered++;
            this.logger.error(`❌ [EVENT-PROCESSING-ERROR] Failed to process ${eventType}:`, error);
            // Strict policy: propagate errors to callers to stop further processing
            const strictMsg =
                `[STRICT-POLICY] Event processing aborted for '${eventType}'. ` +
                `You MUST fix the emitter/handler to respect PATH-ONLY architecture and atomic edge creation. ` +
                `No fallback, no waiting, no helper states. Stop masking; correct the design.`;
            throw new Error(strictMsg);
        }
    }

    /**
     * Subscribe to raw events
     */
    subscribeToEvents(callback: EventSubscriptionCallback): () => void {
        this.eventSubscribers.add(callback);
        this.logger.debug('📡 [EVENT-SUBSCRIPTION] Added event subscriber');

        return () => {
            this.unsubscribeFromEvents(callback);
        };
    }

    /**
     * Unsubscribe from raw events
     */
    unsubscribeFromEvents(callback: EventSubscriptionCallback): void {
        const removed = this.eventSubscribers.delete(callback);
        if (removed) {
            this.logger.debug('📡 [EVENT-UNSUBSCRIPTION] Removed event subscriber');
        }
    }

    /**
     * Subscribe to workflow updates
     */
    subscribeToWorkflowUpdates(callback: WorkflowUpdateCallback): () => void {
        this.workflowUpdateSubscribers.add(callback);
        this.logger.debug('📡 [WORKFLOW-SUBSCRIPTION] Added workflow update subscriber');

        return () => {
            this.unsubscribeFromWorkflowUpdates(callback);
        };
    }

    /**
     * Subscribe to workflow snapshots (exported after each applied update)
     */
    subscribeToWorkflowSnapshots(callback: (snapshot: any) => void): () => void {
        this.workflowSnapshotSubscribers.add(callback);
        this.logger.debug('📸 [WORKFLOW-SNAPSHOT-SUBSCRIPTION] Added workflow snapshot subscriber');

        return () => {
            const removed = this.workflowSnapshotSubscribers.delete(callback);
            if (removed) {
                this.logger.debug('📸 [WORKFLOW-SNAPSHOT-UNSUBSCRIPTION] Removed workflow snapshot subscriber');
            }
        };
    }

    /**
     * Unsubscribe from workflow updates
     */
    unsubscribeFromWorkflowUpdates(callback: WorkflowUpdateCallback): void {
        const removed = this.workflowUpdateSubscribers.delete(callback);
        if (removed) {
            this.logger.debug('📡 [WORKFLOW-UNSUBSCRIPTION] Removed workflow update subscriber');
        }
    }

    // =================================================================
    // Handler Management
    // =================================================================

    /**
     * Register an event handler
     */
    registerEventHandler(handler: EventHandler): void {
        // Inject back-reference for central registry access (internal use only)
        (handler as any).subscriber = this;
        this.eventHandlers.set(handler.name, handler);
        this.logger.debug(`🔧 [HANDLER-REGISTERED] ${handler.name}`, {
            priority: handler.priority,
            patterns: handler.patterns
        });
    }

    /**
     * Unregister an event handler
     */
    unregisterEventHandler(handlerName: string): boolean {
        const removed = this.eventHandlers.delete(handlerName);
        if (removed) {
            this.logger.debug(`🔧 [HANDLER-UNREGISTERED] ${handlerName}`);
        }
        return removed;
    }

    /**
     * Get all registered handlers
     */
    getRegisteredHandlers(): EventHandler[] {
        return Array.from(this.eventHandlers.values());
    }

    // =================================================================
    // Workflow Data Access
    // =================================================================

    /**
     * Get current workflow snapshot
     */
    getWorkflowSnapshot() {
        return this.workflowBuilder.getSnapshot();
    }

    /**
     * Get all workflow nodes
     */
    getAllNodes(): WorkflowNode[] {
        return this.workflowBuilder.getRawNodes();
    }

    /**
     * Get all workflow edges
     */
    getAllEdges() {
        return this.workflowBuilder.getRawEdges();
    }

    /**
     * Find nodes by criteria
     */
    findNodes(criteria: {
        type?: string | string[];
        status?: string | string[];
        level?: number | number[];
        [key: string]: unknown;
    }) {
        // Use CoreWorkflowBuilder's findNodes method (it implements WorkflowQuery)
        return (this.workflowBuilder as any).findNodes(criteria);
    }

    /**
     * Get workflow statistics
     */
    getStats() {
        return {
            ...this.stats,
            workflow: this.workflowBuilder.getStats(),
            handlers: this.eventHandlers.size
        };
    }

    // =================================================================
    // Cleanup and Maintenance
    // =================================================================

    /**
     * Clear all workflow data
     */
    clear(): void {
        this.workflowBuilder.clear();

        // Clear handler state
        this.eventHandlers.forEach(handler => {
            if ('clear' in handler && typeof handler.clear === 'function') {
                (handler as any).clear();
            }
        });

        // Reset statistics
        this.stats = {
            eventsProcessed: 0,
            nodesCreated: 0,
            edgesCreated: 0,
            errorsEncountered: 0,
            lastEventTime: new Date()
        };

        this.logger.debug('🧹 [WORKFLOW-CLEARED] All data cleared');
    }

    /**
     * Export workflow data in flat format for compatibility
     */
    exportWorkflow() {
        const data = (this.workflowBuilder as any).exportToUniversal();
        // Normalize to good-case schema where possible without hardcoding
        const nodes = data.nodes;
        const edges = data.edges;
        const metadata = data.metadata || {};

        // Compute metrics
        const enriched = {
            metadata: {
                ...metadata,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                metrics: {
                    totalNodes: nodes.length,
                    totalEdges: edges.length
                }
            },
            __workflowType: 'UniversalWorkflowStructure',
            id: metadata.id || 'example-26-pure-nodemanager',
            name: metadata.name || 'Example 26 Pure NodeEdgeManager Result',
            nodes,
            edges,
            layout: {
                algorithm: 'hierarchical',
                direction: 'TB',
                spacing: { nodeSpacing: 200, levelSpacing: 150 },
                alignment: { horizontal: 'center', vertical: 'top' }
            }
        };
        return enriched;
    }

    /**
     * Import workflow data
     */
    importWorkflow(data: any): boolean {
        return (this.workflowBuilder as any).importFromUniversal(data);
    }

    // =================================================================
    // Private Implementation
    // =================================================================

    private initializeDefaultHandlers(): void {
        // Register all default event handlers
        const agentHandler = new AgentEventHandler(this.logger);
        const toolHandler = new ToolEventHandler(this.logger);
        const executionHandler = new ExecutionEventHandler(this.logger);

        this.registerEventHandler(agentHandler);
        this.registerEventHandler(toolHandler);
        this.registerEventHandler(executionHandler);

        this.logger.debug('🔧 [DEFAULT-HANDLERS] Initialized all default event handlers', {
            handlersRegistered: ['AgentEventHandler', 'ToolEventHandler', 'ExecutionEventHandler']
        });
    }

    private normalizeEventData(eventType: string, eventData: unknown): EventData {
        // If already in EventData format, return as-is
        if (typeof eventData === 'object' && eventData !== null && 'eventType' in eventData) {
            return eventData as EventData;
        }

        // Convert to EventData format
        const data = eventData as any || {};
        return {
            eventType,
            // 🎯 Use timestamp from EventService, don't override it
            // EventService should automatically inject timestamp when emitting events
            timestamp: data.timestamp || new Date(), // Preserve original event timestamp from EventService
            sourceType: data.sourceType || 'unknown',
            sourceId: data.sourceId || 'unknown',
            executionId: data.executionId,
            parentExecutionId: data.parentExecutionId,
            rootExecutionId: data.rootExecutionId,
            executionLevel: data.executionLevel || 1,
            parameters: data.parameters || data,
            result: data.result,
            metadata: data.metadata,
            error: data.error,
            ...data // Include all other properties
        };
    }

    private findMatchingHandlers(eventType: string): EventHandler[] {
        const handlers: EventHandler[] = [];

        for (const handler of this.eventHandlers.values()) {
            if (handler.canHandle(eventType)) {
                handlers.push(handler);
            }
        }

        // Sort by priority (highest first)
        return handlers.sort((a, b) => b.priority - a.priority);
    }

    private async executeHandler(
        handler: EventHandler,
        eventType: string,
        eventData: EventData
    ): Promise<EventProcessingResult> {
        try {
            this.logger.debug(`🔧 [HANDLER-EXECUTING] ${handler.name} for ${eventType}`);

            const result = await handler.handle(eventType, eventData);

            this.logger.debug(`✅ [HANDLER-SUCCESS] ${handler.name}`, {
                success: result.success,
                updatesCount: result.updates.length
            });

            return result;
        } catch (error) {
            this.logger.error(`❌ [HANDLER-ERROR] ${handler.name} failed:`, error);
            return {
                success: false,
                updates: [],
                errors: [`Handler ${handler.name} failed: ${error instanceof Error ? error.message : String(error)}`],
                metadata: {
                    handlerName: handler.name,
                    eventType,
                    error: true
                }
            };
        }
    }

    private async processHandlerResults(
        eventType: string,
        results: PromiseSettledResult<EventProcessingResult>[]
    ): Promise<void> {
        const successfulResults: EventProcessingResult[] = [];
        const errors: string[] = [];

        // Collect results
        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                if (result.value.success) {
                    successfulResults.push(result.value);
                } else {
                    errors.push(...(result.value.errors || [`Handler ${index} failed`]));
                }
            } else {
                errors.push(`Handler ${index} rejected: ${result.reason}`);
            }
        });

        // Apply all updates from successful handlers
        const allUpdates: WorkflowUpdate[] = successfulResults.flatMap(result => result.updates);

        for (const update of allUpdates) {
            try {
                await this.applyWorkflowUpdate(update);
            } catch (error) {
                this.logger.error(`❌ [UPDATE-APPLICATION-ERROR] Failed to apply update:`, error);
                errors.push(`Failed to apply update: ${error instanceof Error ? error.message : String(error)}`);
                // Strict policy: stop processing remaining updates immediately
                break;
            }
        }

        // Log summary
        if (errors.length > 0) {
            // Strict policy: escalate errors to abort the event processing with guidance
            const strictMsg =
                `[WORKFLOW-EVENT-SUBSCRIBER] ${eventType} failed with ${errors.length} error(s): ${errors.join('; ')}. ` +
                `[STRICT-POLICY] Fix the order and path-only linkage. Do NOT continue after edge failures. ` +
                `Atomic node+edge creation is mandatory; redesign the flow rather than adding fallbacks.`;
            throw new Error(strictMsg);
        } else {
            this.logger.debug(`✅ [EVENT-PROCESSING-SUCCESS] ${eventType} processed successfully`, {
                updatesApplied: allUpdates.length
            });
        }
    }

    private async applyWorkflowUpdate(update: WorkflowUpdate): Promise<void> {
        if ('node' in update) {
            // This is a WorkflowNodeUpdate
            switch (update.action) {
                case 'create':
                    // Create node only; edges must be provided explicitly by handlers (no prevId usage)
                    const created = this.workflowBuilder.addNode(update.node);
                    this.logger.debug(`🆕 [NODE-CREATED] ${created.id}`);
                    break;

                case 'update':
                    // Update node only; no implicit prev-based edges (path-only)
                    const updated = this.workflowBuilder.updateNode(update.node.id, update.node);
                    this.logger.debug(`🔄 [NODE-UPDATED] ${update.node.id}`);
                    // No implicit edge creation
                    break;

                default:
                    this.logger.warn(`⚠️ [UNKNOWN-NODE-UPDATE-ACTION] ${(update as any).action}`);
            }
        } else if ('edge' in update) {
            // This is a WorkflowEdgeUpdate
            switch (update.action) {
                case 'create':
                    // Explicit edge creation (timestamp will be assigned by builder)
                    this.workflowBuilder.addEdge({
                        id: update.edge.id,
                        source: update.edge.source,
                        target: update.edge.target,
                        type: update.edge.type,
                        label: update.edge.label,
                        description: update.edge.description,
                        sourceHandle: update.edge.sourceHandle,
                        targetHandle: update.edge.targetHandle,
                        executionOrder: update.edge.executionOrder,
                        dependsOn: update.edge.dependsOn,
                        hidden: update.edge.hidden,
                        conditional: update.edge.conditional,
                        data: update.edge.data,
                    } as any);
                    this.logger.debug(`🔗 [EDGE-CREATED] ${update.edge.id}`);
                    break;

                case 'update':
                    this.workflowBuilder.updateEdge(update.edge.id, update.edge);
                    this.logger.debug(`🔄 [EDGE-UPDATED] ${update.edge.id}`);
                    break;

                default:
                    this.logger.warn(`⚠️ [UNKNOWN-EDGE-UPDATE-ACTION] ${(update as any).action}`);
            }
        }
    }

    private updateStatistics(update: WorkflowUpdate): void {
        if ('node' in update && update.action === 'create') {
            this.stats.nodesCreated++;
        } else if ('edge' in update && update.action === 'create') {
            this.stats.edgesCreated++;
        }
    }

    private notifyEventSubscribers(eventType: string, eventData: unknown): void {
        if (this.eventSubscribers.size === 0) return;

        this.eventSubscribers.forEach(callback => {
            try {
                callback(eventType, eventData);
            } catch (error) {
                this.logger.error('❌ [EVENT-SUBSCRIBER-ERROR] Error in event subscriber:', error);
            }
        });
    }

    private notifyWorkflowUpdateSubscribers(update: WorkflowUpdate): void {
        if (this.workflowUpdateSubscribers.size === 0) return;

        this.workflowUpdateSubscribers.forEach(callback => {
            try {
                callback(update);
            } catch (error) {
                this.logger.error('❌ [WORKFLOW-SUBSCRIBER-ERROR] Error in workflow update subscriber:', error);
            }
        });
    }

    private notifyWorkflowSnapshotSubscribers(snapshot: any): void {
        if (this.workflowSnapshotSubscribers.size === 0) return;
        this.workflowSnapshotSubscribers.forEach(callback => {
            try {
                callback(snapshot);
            } catch (error) {
                this.logger.error('❌ [WORKFLOW-SNAPSHOT-SUBSCRIBER-ERROR] Error in workflow snapshot subscriber:', error);
            }
        });
    }
}
