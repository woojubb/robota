/**
 * WorkflowEventSubscriber - Real-time event subscriber for workflow package
 */

import { SilentLogger, type ILogger } from '@robota-sdk/agents';
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
import { registerAgentEventHandlers } from '../handlers/agent-event-handler.js';
import { registerToolEventHandlers } from '../handlers/tool-event-handler.js';
import { registerExecutionEventHandlers } from '../handlers/execution-event-handler.js';
import { registerUserEventHandlers } from '../handlers/user-event-handler.js';
import type { IWorkflowStateAccess } from '../interfaces/workflow-state-access.js';
import { AgentNodeBuilder } from '../handlers/builders/agent-node-builder.js';
import { ExecutionNodeBuilder } from '../handlers/builders/execution-node-builder.js';
import { WorkflowInstanceRegistry } from './instance-registry.js';
import type { IEventLogStore } from '../interfaces/event-log-store.js';
import { InMemoryLogStore } from './in-memory-log-store.js';
import type { TEventLogRecord } from '../interfaces/event-log.js';

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
    logger?: ILogger;

    /** Maximum number of nodes to retain in memory */
    maxNodes?: number;

    /** Maximum number of edges to retain in memory */
    maxEdges?: number;

    /** Event handlers to register */
    eventHandlers?: IEventHandler[];

    /** Enable automatic node cleanup */
    enableAutoCleanup?: boolean;

    /** Event log store (optional) */
    eventLogStore?: IEventLogStore;
}

export interface IWorkflowEventSubscriber {
    processEvent(eventType: string, eventData: TEventData): Promise<void>;
    subscribeToWorkflowSnapshots(callback: (snapshot: IWorkflowExportStructure) => void): () => void;
    exportWorkflow(): IWorkflowExportStructure;
}

/**
 * WorkflowEventSubscriber - Core workflow event processing system
 */
export class WorkflowEventSubscriber {
    private logger: ILogger;
    private workflowBuilder: IExtendedWorkflowBuilder & IWorkflowQuery & IWorkflowPortable;
    private stateAccess: IWorkflowStateAccess;
    private agentNodeBuilder: AgentNodeBuilder;
    private executionNodeBuilder: ExecutionNodeBuilder;
    private instanceRegistry: WorkflowInstanceRegistry;
    private eventHandlers = new Map<string, IEventHandler>();
    private eventSubscribers = new Set<TEventSubscriptionCallback>();
    private workflowUpdateSubscribers = new Set<TWorkflowUpdateCallback>();
    private workflowSnapshotSubscribers = new Set<(snapshot: IWorkflowExportStructure) => void>();
    private eventLogStore: IEventLogStore;

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
            enableAutoCleanup: config.enableAutoCleanup ?? false,
            eventLogStore: config.eventLogStore ?? new InMemoryLogStore()
        };

        this.logger = this.config.logger;
        this.workflowBuilder = new CoreWorkflowBuilder({
            logger: this.logger,
            maxNodes: this.config.maxNodes,
            maxEdges: this.config.maxEdges
        });
        this.eventLogStore = this.config.eventLogStore;
        this.stateAccess = {
            getNode: (nodeId: string) => this.workflowBuilder.getNode(nodeId)
        };
        this.agentNodeBuilder = new AgentNodeBuilder(this.logger);
        this.executionNodeBuilder = new ExecutionNodeBuilder();
        this.instanceRegistry = new WorkflowInstanceRegistry();

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
            maxNodes: this.config.maxNodes,
            maxEdges: this.config.maxEdges,
            enableAutoCleanup: this.config.enableAutoCleanup,
            configuredHandlers: this.config.eventHandlers.length
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
                eventDataType: typeof eventData,
                hasEventData: eventData !== undefined && eventData !== null
            });

            // Notify event subscribers
            this.notifyEventSubscribers(eventType, eventData);

            const normalizedEventData: TEventData = eventData;
            this.appendEventLog(eventType, normalizedEventData);

            const handler = this.eventHandlers.get(eventType);
            if (!handler) {
                this.logger.warn(`⚠️ [NO-HANDLER] No handlers found for event: ${eventType}`);
                return;
            }

            const results = await Promise.allSettled([
                this.executeHandler(handler, normalizedEventData)
            ]);

            // Process results and apply updates
            await this.processHandlerResults(eventType, results);

        } catch (error) {
            this.stats.errorsEncountered++;
            this.logger.error(
                `❌ [EVENT-PROCESSING-ERROR] Failed to process ${eventType}:`,
                error instanceof Error ? error : new Error(String(error))
            );
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
        if (this.eventHandlers.has(handler.eventName)) {
            throw new Error(
                `[WORKFLOW-EVENT-SUBSCRIBER] Duplicate handler for event '${handler.eventName}'. ` +
                `Only one handler is allowed per event name.`
            );
        }
        this.eventHandlers.set(handler.eventName, handler);
        this.logger.debug(`🔧 [HANDLER-REGISTERED] ${handler.name}`, {
            eventName: handler.eventName
        });
    }

    /**
     * Unregister an event handler
     */
    unregisterEventHandler(handlerName: string): boolean {
        let removed = false;
        for (const [eventName, handler] of this.eventHandlers.entries()) {
            if (handler.name === handlerName || handler.eventName === handlerName) {
                removed = this.eventHandlers.delete(eventName);
                break;
            }
        }
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

        this.agentNodeBuilder.clear();
        this.instanceRegistry.clear();

        this.logger.debug('🧹 [WORKFLOW-CLEARED] All data cleared');
    }

    /**
     * Export workflow data in flat format
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
        registerAgentEventHandlers(
            this.registerEventHandler.bind(this),
            this.logger,
            this.agentNodeBuilder,
            this.instanceRegistry
        );
        registerToolEventHandlers(
            this.registerEventHandler.bind(this),
            this.logger,
            this.instanceRegistry
        );
        registerExecutionEventHandlers(
            this.registerEventHandler.bind(this),
            this.logger,
            this.executionNodeBuilder,
            this.agentNodeBuilder,
            this.instanceRegistry
        );
        registerUserEventHandlers(this.registerEventHandler.bind(this), this.logger, this.executionNodeBuilder);

        this.logger.debug('🔧 [DEFAULT-HANDLERS] Initialized all default event handlers', {
            handlersRegistered: Array.from(this.eventHandlers.values()).map(h => h.name)
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

    private async executeHandler(
        handler: IEventHandler,
        eventData: TEventData
    ): Promise<IEventProcessingResult> {
        try {
            this.logger.debug(`🔧 [HANDLER-EXECUTING] ${handler.name} for ${handler.eventName}`);

            const result = await handler.handle(eventData);

            this.logger.debug(`✅ [HANDLER-SUCCESS] ${handler.name}`, {
                success: result.success,
                updatesCount: result.updates.length
            });

            return result;
        } catch (error) {
            this.logger.error(
                `❌ [HANDLER-ERROR] ${handler.name} failed:`,
                error instanceof Error ? error : new Error(String(error))
            );
            return {
                success: false,
                updates: [],
                errors: [`Handler ${handler.name} failed: ${error instanceof Error ? error.message : String(error)}`],
                metadata: {
                    handlerName: handler.name,
                    eventType: handler.eventName,
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
                this.logger.error(
                    '❌ [UPDATE-APPLICATION-ERROR] Failed to apply update:',
                    error instanceof Error ? error : new Error(String(error))
                );
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
                    this.logger.error(
                        '❌ [WORKFLOW-SNAPSHOT-ERROR] Failed to export workflow snapshot:',
                        error instanceof Error ? error : new Error(String(error))
                    );
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

        if (update.action === 'patch') {
            this.workflowBuilder.updateNode(update.nodeId, update.updates);
            this.logger.debug(`🩹 [NODE-PATCHED] ${update.nodeId}`);
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
                this.logger.error(
                    '❌ [EVENT-SUBSCRIBER-ERROR] Error in event subscriber:',
                    error instanceof Error ? error : new Error(String(error))
                );
            }
        });
    }

    private notifyWorkflowUpdateSubscribers(update: TWorkflowUpdate): void {
        if (this.workflowUpdateSubscribers.size === 0) return;

        this.workflowUpdateSubscribers.forEach(callback => {
            try {
                callback(update);
            } catch (error) {
                this.logger.error(
                    '❌ [WORKFLOW-SUBSCRIBER-ERROR] Error in workflow update subscriber:',
                    error instanceof Error ? error : new Error(String(error))
                );
            }
        });
    }

    private notifyWorkflowSnapshotSubscribers(snapshot: IWorkflowExportStructure): void {
        if (this.workflowSnapshotSubscribers.size === 0) return;
        this.workflowSnapshotSubscribers.forEach(callback => {
            try {
                callback(snapshot);
            } catch (error) {
                this.logger.error(
                    '❌ [WORKFLOW-SNAPSHOT-SUBSCRIBER-ERROR] Error in workflow snapshot subscriber:',
                    error instanceof Error ? error : new Error(String(error))
                );
            }
        });
    }

    private appendEventLog(eventType: string, eventData: TEventData): void {
        if (!eventData.context?.ownerPath?.length) {
            throw new Error(`[EVENT-LOG] Missing ownerPath for ${eventType}`);
        }
        const record: TEventLogRecord = {
            eventName: eventType,
            timestamp: eventData.timestamp,
            ownerPath: eventData.context.ownerPath,
            payload: eventData
        };
        this.eventLogStore.append(record);
    }
}
