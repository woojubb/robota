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
    IEventHandler,
    TEventData,
    IEventProcessingResult
} from '../interfaces/event-handler.js';
import type { IWorkflowNode } from '../interfaces/workflow-node.js';
import type {
    IExtendedWorkflowBuilder,
    IWorkflowQuery,
    IWorkflowPortable,
    TWorkflowBuilderExtensionValue,
    TWorkflowUpdate,
    TWorkflowUpdateCallback,
    IWorkflowSnapshot
} from '../interfaces/workflow-builder.js';
import { CoreWorkflowBuilder } from './workflow-builder.js';
import { AgentEventHandler } from '../handlers/agent-event-handler.js';
import { ToolEventHandler } from '../handlers/tool-event-handler.js';

import { ExecutionEventHandler } from '../handlers/execution-event-handler.js';

/**
 * Event subscription callback for external integrations
 */
export type TEventSubscriptionCallback = (eventType: string, eventData: TEventData) => void;

export interface IWorkflowExportLayout {
    algorithm: string;
    direction: string;
    spacing: { nodeSpacing: number; levelSpacing: number };
    alignment: { horizontal: string; vertical: string };
}

export interface IWorkflowExportMetadata {
    createdAt: string;
    updatedAt: string;
    metrics: { totalNodes: number; totalEdges: number };
    [key: string]: TWorkflowBuilderExtensionValue | undefined;
}

export interface IWorkflowExportStructure {
    __workflowType: 'UniversalWorkflowStructure';
    id: string;
    name: string;
    nodes: IWorkflowNode[];
    edges: ReturnType<IWorkflowPortable['exportToUniversal']>['edges'];
    metadata: IWorkflowExportMetadata;
    layout: IWorkflowExportLayout;
}

/**
 * WorkflowEventSubscriber Configuration
 */
export interface IWorkflowEventSubscriberConfig {
    /** Logger instance for debugging */
    logger?: SimpleLogger;

    /** Maximum number of nodes to retain in memory */
    maxNodes?: number;

    /** Maximum number of edges to retain in memory */
    maxEdges?: number;

    /** Event handlers to register */
    eventHandlers?: IEventHandler[];

    /** Enable automatic node cleanup */
    enableAutoCleanup?: boolean;
}

/**
 * WorkflowEventSubscriber - Core workflow event processing system
 */
export class WorkflowEventSubscriber {
    private logger: SimpleLogger;
    private workflowBuilder: IExtendedWorkflowBuilder & IWorkflowQuery & IWorkflowPortable;
    private eventHandlers = new Map<string, IEventHandler>();
    private eventSubscribers = new Set<TEventSubscriptionCallback>();
    private workflowUpdateSubscribers = new Set<TWorkflowUpdateCallback>();
    private workflowSnapshotSubscribers = new Set<(snapshot: IWorkflowExportStructure) => void>();

    // Configuration
    private config: Required<IWorkflowEventSubscriberConfig>;

    // Statistics
    private stats = {
        eventsProcessed: 0,
        nodesCreated: 0,
        edgesCreated: 0,
        errorsEncountered: 0,
        lastEventTime: new Date()
    };

    constructor(config: IWorkflowEventSubscriberConfig = {}) {
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

        // Subscribe to workflow updates: apply stats and notify update subscribers
        // Note: Snapshot emission moved to processHandlerResults for atomic batch completion
        this.workflowBuilder.subscribe((update) => {
            this.updateStatistics(update);
            this.notifyWorkflowUpdateSubscribers(update);
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
    async processEvent(eventType: string, eventData: TEventData): Promise<void> {
        try {
            this.stats.eventsProcessed++;
            this.stats.lastEventTime = new Date();

            this.logger.debug(`📡 [EVENT-RECEIVED] ${eventType}`, {
                eventData: typeof eventData === 'object' ? eventData : { value: eventData }
            });

            // Notify event subscribers
            this.notifyEventSubscribers(eventType, eventData);

            const normalizedEventData: TEventData = eventData;

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
    subscribeToEvents(callback: TEventSubscriptionCallback): () => void {
        this.eventSubscribers.add(callback);
        this.logger.debug('📡 [EVENT-SUBSCRIPTION] Added event subscriber');

        return () => {
            this.unsubscribeFromEvents(callback);
        };
    }

    /**
     * Unsubscribe from raw events
     */
    unsubscribeFromEvents(callback: TEventSubscriptionCallback): void {
        const removed = this.eventSubscribers.delete(callback);
        if (removed) {
            this.logger.debug('📡 [EVENT-UNSUBSCRIPTION] Removed event subscriber');
        }
    }

    /**
     * Subscribe to workflow updates
     */
    subscribeToWorkflowUpdates(callback: TWorkflowUpdateCallback): () => void {
        this.workflowUpdateSubscribers.add(callback);
        this.logger.debug('📡 [WORKFLOW-SUBSCRIPTION] Added workflow update subscriber');

        return () => {
            this.unsubscribeFromWorkflowUpdates(callback);
        };
    }

    /**
     * Subscribe to workflow snapshots (exported after each applied update)
     */
    subscribeToWorkflowSnapshots(callback: (snapshot: IWorkflowExportStructure) => void): () => void {
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
    unsubscribeFromWorkflowUpdates(callback: TWorkflowUpdateCallback): void {
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
    registerEventHandler(handler: IEventHandler): void {
        // Inject back-reference for central registry access (internal use only)
        (handler as { subscriber?: WorkflowEventSubscriber }).subscriber = this;
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
    getRegisteredHandlers(): IEventHandler[] {
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
    getAllNodes(): IWorkflowNode[] {
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
        [key: string]: TWorkflowBuilderExtensionValue | undefined;
    }) {
        // Use CoreWorkflowBuilder's findNodes method (it implements WorkflowQuery)
        return this.workflowBuilder.findNodes(criteria);
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
                (handler as { clear?: () => void }).clear?.();
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
        const data = this.workflowBuilder.exportToUniversal();
        // Normalize to good-case schema where possible without hardcoding
        const nodes = data.nodes;
        const edges = data.edges;
        const metadata = data.metadata || {};
        const workflowId =
            typeof metadata.id === 'string' && metadata.id.length > 0
                ? metadata.id
                : 'example-26-pure-nodemanager';
        const workflowName =
            typeof metadata.name === 'string' && metadata.name.length > 0
                ? metadata.name
                : 'Example 26 Pure NodeEdgeManager Result';

        // Compute metrics
        const enriched: IWorkflowExportStructure = {
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
            id: workflowId,
            name: workflowName,
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
    importWorkflow(data: { version: string; format: string; data: IWorkflowSnapshot }): boolean {
        return this.workflowBuilder.importFromUniversal(data);
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

    private normalizeEventData(eventType: string, eventData: TEventData): TEventData {
        if (!eventData.timestamp) {
            throw new Error(`[PATH-ONLY] Missing timestamp for event: ${eventType}`);
        }
        if (!eventData.context?.ownerPath?.length) {
            throw new Error(`[PATH-ONLY] Missing context.ownerPath for event: ${eventType}`);
        }
        return eventData;
    }

    private findMatchingHandlers(eventType: string): IEventHandler[] {
        const handlers: IEventHandler[] = [];

        for (const handler of this.eventHandlers.values()) {
            if (handler.canHandle(eventType)) {
                handlers.push(handler);
            }
        }

        // Sort by priority (highest first)
        return handlers.sort((a, b) => b.priority - a.priority);
    }

    private async executeHandler(
        handler: IEventHandler,
        eventType: string,
        eventData: TEventData
    ): Promise<IEventProcessingResult> {
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
        results: PromiseSettledResult<IEventProcessingResult>[]
    ): Promise<void> {
        const successfulResults: IEventProcessingResult[] = [];
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
        const allUpdates: TWorkflowUpdate[] = successfulResults.flatMap(result => result.updates);

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

            // Emit snapshot ONLY after all updates for this event are successfully applied
            if (this.workflowSnapshotSubscribers.size > 0 && allUpdates.length > 0) {
                try {
                    const snapshot = this.exportWorkflow();
                    this.notifyWorkflowSnapshotSubscribers(snapshot);
                    this.logger.debug(`📸 [WORKFLOW-SNAPSHOT] Emitted after ${eventType} with ${allUpdates.length} updates`);
                } catch (error) {
                    this.logger.error('❌ [WORKFLOW-SNAPSHOT-ERROR] Failed to export workflow snapshot:', error);
                }
            }
        }
    }

    private async applyWorkflowUpdate(update: TWorkflowUpdate): Promise<void> {
        if (update.action === 'clear') {
            this.workflowBuilder.clear();
            this.logger.debug(`🧹 [WORKFLOW-CLEARED]`);
            return;
        }

        if ('node' in update) {
            if (update.action === 'create') {
                const created = this.workflowBuilder.addNode(update.node);
                this.logger.debug(`🆕 [NODE-CREATED] ${created.id}`);
                return;
            }

            if (update.action === 'update') {
                this.workflowBuilder.updateNode(update.node.id, update.node);
                this.logger.debug(`🔄 [NODE-UPDATED] ${update.node.id}`);
                return;
            }

            // Other node actions are intentionally not applied by this subscriber.
            return;
        }

        if ('edge' in update) {
            if (update.action === 'create') {
                const { timestamp: _timestamp, ...edgeData } = update.edge;
                this.workflowBuilder.addEdge(edgeData);
                this.logger.debug(`🔗 [EDGE-CREATED] ${update.edge.id}`);
                return;
            }

            if (update.action === 'update') {
                this.workflowBuilder.updateEdge(update.edge.id, update.edge);
                this.logger.debug(`🔄 [EDGE-UPDATED] ${update.edge.id}`);
                return;
            }

            if (update.action === 'delete') {
                this.workflowBuilder.removeEdge(update.edge.id);
                this.logger.debug(`🗑️ [EDGE-DELETED] ${update.edge.id}`);
            }
        }
    }

    private updateStatistics(update: TWorkflowUpdate): void {
        if ('node' in update && update.action === 'create') {
            this.stats.nodesCreated++;
        } else if ('edge' in update && update.action === 'create') {
            this.stats.edgesCreated++;
        }
    }

    private notifyEventSubscribers(eventType: string, eventData: TEventData): void {
        if (this.eventSubscribers.size === 0) return;

        this.eventSubscribers.forEach(callback => {
            try {
                callback(eventType, eventData);
            } catch (error) {
                this.logger.error('❌ [EVENT-SUBSCRIBER-ERROR] Error in event subscriber:', error);
            }
        });
    }

    private notifyWorkflowUpdateSubscribers(update: TWorkflowUpdate): void {
        if (this.workflowUpdateSubscribers.size === 0) return;

        this.workflowUpdateSubscribers.forEach(callback => {
            try {
                callback(update);
            } catch (error) {
                this.logger.error('❌ [WORKFLOW-SUBSCRIBER-ERROR] Error in workflow update subscriber:', error);
            }
        });
    }

    private notifyWorkflowSnapshotSubscribers(snapshot: IWorkflowExportStructure): void {
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
